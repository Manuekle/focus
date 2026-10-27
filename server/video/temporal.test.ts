import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderParamsSchema, type RenderParamsOf } from "../../shared/render";
import type { NormalizedMedia } from "../../shared/schemas";
import { echoOpacity, planFreeze } from "../../shared/temporal";
import { suggestTemporalEvent } from "../../shared/temporal-events";
import type { TrackPoint } from "../../shared/temporal-track";
import { ffmpeg, probe } from "../ffmpeg";
import { renderComparison, renderVideo, verifyOutput, type MaskSource } from "./compositor";
import { readFrames } from "./frames";
import type { Alpha } from "./masks";

// Time Freeze end to end through real FFmpeg. The clip is a red square
// crossing a blue background (with a swept tone, for the audio policy); the masks
// are read back from the decoded clip's own red pixels, so cutouts, positions
// and timing are checked against what is really in each frame.

const W = 320;
const H = 180;
const FPS = 24;
const FRAMES = 48;
const SIZE = 40;
const Y = 70;
const RED = [220, 30, 40] as const;
const BLUE = [30, 60, 210] as const;

let work: string;
let clip: string;
let silentClip: string;
let sourceFrames: Buffer[];
let alphas: Alpha[];

const media = (hasAudio = true): NormalizedMedia => ({ width: W, height: H, fps: FPS, frameCount: FRAMES, durationSeconds: FRAMES / FPS, codec: "h264", hasAudio });

const isRed = (frame: Buffer, i: number) => frame[i * 4] > 150 && frame[i * 4 + 1] < 110 && frame[i * 4 + 2] < 110;

/** The subject's mask in a decoded frame: exactly its red pixels. */
function maskOf(frame: Buffer): Alpha {
  const data = new Uint8Array(W * H);
  let box: Alpha["box"] = null;
  for (let i = 0; i < W * H; i++) {
    if (!isRed(frame, i)) continue;
    data[i] = 255;
    const x = i % W;
    const y = Math.floor(i / W);
    box = box
      ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x + 1), bottom: Math.max(box.bottom, y + 1) }
      : { left: x, top: y, right: x + 1, bottom: y + 1 };
  }
  return { data, box };
}

const sourceMasks = (override: (index: number) => Alpha | null = () => null): MaskSource => ({
  alphaAt: (index) => override(index) ?? alphas[index],
  subjectMotion: () => null,
});

const leftOf = (index: number) => alphas[index].box!.left;
const rgb = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
const near = (actual: number[], expected: readonly number[], tolerance = 26) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
const mix = (opacity: number) => BLUE.map((value, channel) => Math.round(value + (RED[channel] - value) * opacity));

/** Detection consumes positions measured from the decoded subject's actual pixels. */
function trackOf(masks: readonly Alpha[]): TrackPoint[] {
  return masks.flatMap((alpha, frameIndex) => {
    const box = alpha.box;
    if (!box) return [];
    return [{
      frameIndex, timestamp: frameIndex / FPS, box,
      center: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
      width: box.right - box.left, height: box.bottom - box.top, masked: true, confidence: 0.9,
    }];
  });
}

async function decode(file: string, width = W, height = H): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for await (const frame of readFrames(file, width, height)) frames.push(frame);
  return frames;
}

/** Mono 48 kHz samples of a file's audio track. */
async function pcm(file: string): Promise<Int16Array> {
  const out = path.join(work, `${path.basename(file)}.pcm`);
  await ffmpeg(["-y", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", out]);
  const bytes = await readFile(out);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
}

function rms(samples: Int16Array, fromSeconds: number, toSeconds: number): number {
  const from = Math.round(fromSeconds * 48000);
  const to = Math.round(toSeconds * 48000);
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-freeze-"));
  clip = path.join(work, "clip.mp4");
  silentClip = path.join(work, "silent.mp4");
  const inputs = ["-f", "lavfi", "-i", `color=c=0x1e3cd2:s=${W}x${H}:r=${FPS}:d=${FRAMES / FPS}`, "-f", "lavfi", "-i", `color=c=0xdc1e28:s=${SIZE}x${SIZE}:r=${FPS}:d=${FRAMES / FPS}`];
  const graph = ["-filter_complex", `[0:v][1:v]overlay=x='8+n*6':y=${Y}:eval=frame,format=yuv420p[v]`, "-map", "[v]"];
  await ffmpeg([...inputs, "-f", "lavfi", "-i", `aevalsrc=0.1*sin(2*PI*(220*t+330*t*t)):s=48000:d=${FRAMES / FPS}`, ...graph, "-map", "2:a", "-c:v", "libx264", "-crf", "12", "-c:a", "aac", "-ac", "2", "-shortest", clip]);
  await ffmpeg([...inputs, ...graph, "-c:v", "libx264", "-crf", "12", silentClip]);
  sourceFrames = await decode(clip);
  alphas = sourceFrames.map(maskOf);
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

const freezeParams = (raw: Record<string, unknown> = {}) =>
  RenderParamsSchema.parse({
    effect: "time_freeze_echo",
    trigger: { mode: "manual", timestampMs: 1000 },
    freezeDurationMs: 1000,
    echo: { count: 4, spacingMs: 160, opacity: 0.85 },
    feather: 0,
    ...raw,
  }) as RenderParamsOf<"time_freeze_echo">;

async function render(name: string, params: RenderParamsOf<"time_freeze_echo">, masks = sourceMasks(), source = clip, hasAudio = true) {
  const outputDir = path.join(work, name);
  await mkdir(outputDir, { recursive: true });
  const result = await renderVideo({ normalizedPath: source, media: media(hasAudio), masks, params, outputDir });
  return { ...result, file: path.join(outputDir, "output.mp4"), dir: outputDir };
}

describe("Time Freeze render", () => {
  // T = frame 24, 24 inserted frames, echoes from frames 8, 12, 16, 20.
  const plan = planFreeze(freezeParams(), media());

  it("the synthetic subject really moves and every frame has its mask", () => {
    expect(alphas.every((alpha) => alpha.box !== null)).toBe(true);
    expect(leftOf(24) - leftOf(20)).toBe(24);
    expect(plan).toMatchObject({ triggerFrame: 24, freezeFrames: 24, spacingFrames: 4, requestedSamples: [8, 12, 16, 20], freezeStart: 25, outputFrameCount: 72 });
  });

  it("suggests peak motion from decoded footage and renders that exact source frame", async () => {
    const suggestion = suggestTemporalEvent(trackOf(alphas), "peak_motion", media())!;
    expect(suggestion).not.toBeNull();
    expect(suggestion.frameIndex).toBeGreaterThan(16);
    expect(suggestion.frameIndex).toBeLessThan(32);
    const params = freezeParams({ trigger: { mode: "auto", event: suggestion.event, timestampMs: suggestion.timestampMs } });
    const out = await render("auto-peak", params);
    expect(out.freeze?.plan.triggerFrame).toBe(suggestion.frameIndex);
    expect(out.freeze?.echoFrames.length).toBeGreaterThanOrEqual(2);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES + FPS, hasAudio: true });
  });

  it("suggests the apex of a jumping subject from decoded footage and exports real echoes", async () => {
    const jumpingClip = path.join(work, "jump.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", `color=c=0x1e3cd2:s=${W}x${H}:r=${FPS}:d=2`,
      "-f", "lavfi", "-i", `color=c=0xdc1e28:s=${SIZE}x${SIZE}:r=${FPS}:d=2`,
      "-filter_complex", "[0:v][1:v]overlay=x='8+n*4':y='100-70*max(0,1-pow((n-24)/18,2))':eval=frame,format=yuv420p[v]",
      "-map", "[v]", "-c:v", "libx264", "-crf", "12", jumpingClip,
    ]);
    const frames = await decode(jumpingClip);
    const masks = frames.map(maskOf);
    const suggestion = suggestTemporalEvent(trackOf(masks), "jump_apex", media(false))!;
    expect(suggestion).not.toBeNull();
    // FFmpeg's overlay n starts at 1; the apex is around source frame 23.
    expect(Math.abs(suggestion.frameIndex - 23)).toBeLessThanOrEqual(2);
    const params = freezeParams({ trigger: { mode: "auto", event: suggestion.event, timestampMs: suggestion.timestampMs } });
    const out = await render("auto-jump", params, { alphaAt: (index) => masks[index], subjectMotion: () => null }, jumpingClip, false);
    expect(out.freeze?.plan.triggerFrame).toBe(suggestion.frameIndex);
    expect(out.freeze?.echoFrames.length).toBeGreaterThanOrEqual(2);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES + FPS, hasAudio: false });
    const output = await decode(out.file);
    const frozen = output[out.freeze!.plan.freezeStart + FPS - 1];
    for (const index of [suggestion.frameIndex, ...out.freeze!.echoFrames]) {
      const box = masks[index].box!;
      const color = rgb(frozen, Math.floor((box.left + box.right) / 2), Math.floor((box.top + box.bottom) / 2));
      expect(near(color, BLUE)).toBe(false);
    }
  });

  it("plays, freezes with real cutouts revealed oldest first, then resumes in sync", async () => {
    const out = await render("resume", freezeParams());
    expect(out.frameCount).toBe(72);
    expect(out.freeze?.echoFrames).toEqual([8, 12, 16, 20]);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: 72, hasAudio: true });
    const frames = await decode(out.file);
    expect(frames.length).toBe(72);
    const cy = Y + SIZE / 2;
    // A point only echo k covers: past the older echo's right edge, before the newer one starts.
    const echoPoint = (frame: number) => leftOf(frame) + 20;

    // Before the freeze: the original video, subject where it was.
    for (const index of [0, 12, 24]) {
      expect(near(rgb(frames[index], leftOf(index) + SIZE / 2, cy), RED)).toBe(true);
      expect(near(rgb(frames[index], echoPoint(8), cy), index === 0 ? rgb(sourceFrames[0], echoPoint(8), cy) : BLUE)).toBe(true);
    }

    // First frozen frame: only the oldest echo has begun to appear.
    const early = frames[plan.freezeStart];
    expect(near(rgb(early, echoPoint(20), cy), BLUE)).toBe(true);
    expect(near(rgb(early, echoPoint(8), cy), BLUE)).toBe(false);

    // Midway (freeze frame 5): the two oldest are in, the two newest not yet.
    const mid = frames[plan.freezeStart + 5];
    expect(near(rgb(mid, echoPoint(8), cy), mix(echoOpacity(0, 4, 0.85)))).toBe(true);
    expect(near(rgb(mid, echoPoint(12), cy), mix(echoOpacity(1, 4, 0.85)))).toBe(true);
    expect(near(rgb(mid, echoPoint(16), cy), BLUE)).toBe(true);
    expect(near(rgb(mid, echoPoint(20), cy), BLUE)).toBe(true);

    // Last frozen frame: every echo at its own opacity, older fainter; the frozen subject solid on top.
    const hold = frames[plan.freezeStart + plan.freezeFrames - 1];
    [8, 12, 16, 20].forEach((frame, rank) => expect(near(rgb(hold, echoPoint(frame), cy), mix(echoOpacity(rank, 4, 0.85)))).toBe(true));
    expect(near(rgb(hold, leftOf(24) + SIZE / 2, cy), RED)).toBe(true);
    // Nothing above or below the subject's path changed: cutouts, not boxes.
    expect(near(rgb(hold, echoPoint(12), Y - 6), BLUE)).toBe(true);
    // The whole freeze holds frame 24's background and subject.
    expect(near(rgb(frames[plan.freezeStart + 12], leftOf(24) + SIZE / 2, cy), RED)).toBe(true);
    expect(near(rgb(frames[plan.freezeStart + 12], leftOf(26) + SIZE - 2, cy), BLUE)).toBe(true);

    // After the freeze: source frame 25 onward, with no echoes left behind.
    for (const j of [0, 10, 22]) {
      const output = frames[plan.freezeStart + plan.freezeFrames + j];
      expect(near(rgb(output, leftOf(25 + j) + SIZE / 2, cy), RED)).toBe(true);
      expect(near(rgb(output, echoPoint(12), cy), BLUE)).toBe(true);
    }
  });

  it("mutes the inserted freeze and resumes the original audio in sync", async () => {
    const out = await render("audio", freezeParams());
    const facts = await probe(out.file);
    const audio = facts.streams.find((stream) => stream.codec_type === "audio");
    expect(Number(audio?.duration)).toBeCloseTo(72 / FPS, 1);
    const samples = await pcm(out.file);
    const source = await pcm(clip);
    const freezeFrom = plan.freezeStart / FPS;
    const freezeTo = (plan.freezeStart + plan.freezeFrames) / FPS;
    expect(rms(samples, 0.1, freezeFrom - 0.05)).toBeGreaterThan(1000);
    expect(rms(samples, freezeFrom + 0.05, freezeTo - 0.05)).toBeLessThan(50);
    expect(rms(samples, freezeTo + 0.05, 72 / FPS - 0.1)).toBeGreaterThan(1000);
    // Resumed audio is the source audio shifted by exactly the freeze.
    const shift = (freezeTo - freezeFrom) * 48000;
    const at = Math.round((freezeTo + 0.4) * 48000);
    let diff = 0;
    for (let i = 0; i < 480; i++) diff += Math.abs(samples[at + i] - source[at + i - Math.round(shift)]);
    expect(diff / 480).toBeLessThan(800);
    // A swept tone makes a wrong source time detectable; a constant tone
    // could accidentally agree after a whole number of audio periods.
    const error = (offset: number) => {
      let sum = 0;
      for (let i = 0; i < 2400; i++) sum += Math.abs(samples[at + i] - source[at + i - Math.round(shift) + offset]);
      return sum / 2400;
    };
    expect(error(0)).toBeLessThan(error(Math.round(48000 / FPS)) * 0.5);
    expect(error(0)).toBeLessThan(error(-Math.round(48000 / FPS)) * 0.5);
  });

  it("pads short source audio to the source timeline before inserting the silent freeze", async () => {
    const short = path.join(work, "short-audio.mp4");
    await ffmpeg(["-i", clip, "-filter_complex", "[0:a]atrim=end=0.4[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", short]);
    const out = await render("short-audio", freezeParams(), sourceMasks(), short);
    const audio = (await probe(out.file)).streams.find((stream) => stream.codec_type === "audio");
    expect(Number(audio?.duration)).toBeCloseTo(72 / FPS, 1);
    const samples = await pcm(out.file);
    expect(rms(samples, 0.1, 0.3)).toBeGreaterThan(1000);
    expect(rms(samples, 0.5, 0.9)).toBeLessThan(50);
    expect(rms(samples, 1.1, 2.9)).toBeLessThan(50);
  });

  it("preserves a source soundtrack's leading silence instead of moving it to time zero", async () => {
    const delayed = path.join(work, "source-delayed.mp4");
    await ffmpeg(["-i", clip, "-itsoffset", "0.3", "-i", clip, "-map", "0:v", "-map", "1:a", "-c", "copy", delayed]);
    const out = await render("source-delayed", freezeParams(), sourceMasks(), delayed);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: out.frameCount, hasAudio: true, timingToleranceSeconds: 1 / FPS });
    const samples = await pcm(out.file);
    expect(rms(samples, 0.05, 0.2)).toBeLessThan(50);
    expect(rms(samples, 0.4, 0.8)).toBeGreaterThan(1000);
    expect(rms(samples, 1.1, 2.0)).toBeLessThan(50);
  });

  it("can end on the hold instead of resuming", async () => {
    const out = await render("hold", freezeParams({ resume: false }));
    expect(out.frameCount).toBe(25 + 24);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: 49, hasAudio: true });
  });

  it("works without audio", async () => {
    const out = await render("silent", freezeParams(), sourceMasks(), silentClip, false);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: 72, hasAudio: false });
  });

  it.each([
    { timestampMs: 1958, freezeDurationMs: 500, resume: true },
    { timestampMs: 1958, freezeDurationMs: 3000, resume: false },
    { timestampMs: 1000, freezeDurationMs: 500, resume: false },
  ])("keeps both MP4 clocks aligned at the boundaries: %j", async ({ timestampMs, freezeDurationMs, resume }) => {
    const params = freezeParams({ trigger: { mode: "manual", timestampMs }, freezeDurationMs, resume });
    const out = await render(`boundary-${timestampMs}-${freezeDurationMs}-${resume}`, params);
    const expected = { width: W, height: H, fps: FPS, frameCount: out.frameCount, hasAudio: true, timingToleranceSeconds: 1 / FPS };
    await verifyOutput(out.file, expected);
    const comparePath = path.join(out.dir, "compare.mp4");
    await renderComparison({ normalizedPath: clip, outputPath: out.file, comparePath, width: W, height: H, background: "dark", freeze: { ...out.freeze!.plan, resume } });
    await verifyOutput(comparePath, { ...expected, height: H * 2 });
    const samples = await pcm(comparePath);
    const from = out.freeze!.plan.freezeStart / FPS;
    expect(rms(samples, from + 0.05, out.frameCount / FPS - 0.05)).toBeLessThan(50);
  });

  it("rejects truncated or delayed audio instead of accepting a video-only duration match", async () => {
    const out = await render("verify-audio", freezeParams());
    const expected = { width: W, height: H, fps: FPS, frameCount: out.frameCount, hasAudio: true, timingToleranceSeconds: 1 / FPS };
    await verifyOutput(out.file, expected);
    const truncated = path.join(out.dir, "truncated.mp4");
    await ffmpeg(["-i", out.file, "-filter_complex", "[0:a]atrim=end=0.5[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", truncated]);
    await expect(verifyOutput(truncated, expected)).rejects.toMatchObject({ code: "export_invalid", detail: expect.stringContaining("duración de audio") });
    const delayed = path.join(out.dir, "delayed.mp4");
    await ffmpeg(["-i", out.file, "-itsoffset", "0.25", "-i", out.file, "-map", "0:v", "-map", "1:a", "-c", "copy", delayed]);
    await expect(verifyOutput(delayed, expected)).rejects.toMatchObject({ code: "export_invalid", detail: expect.stringContaining("inicio de audio") });
  });

  it("holds the original half of the comparison for the same frames", async () => {
    const out = await render("compare", freezeParams());
    const comparePath = path.join(out.dir, "compare.mp4");
    await renderComparison({ normalizedPath: clip, outputPath: out.file, comparePath, width: W, height: H, background: "dark", freeze: { ...plan, resume: true } });
    await verifyOutput(comparePath, { width: W, height: H * 2, fps: FPS, frameCount: 72, hasAudio: true });
    // Remux the already edited track: no second audio edit or AAC generation.
    const comparisonAudio = await pcm(comparePath);
    const editedAudio = await pcm(out.file);
    expect(comparisonAudio.length).toBe(editedAudio.length);
    expect(Buffer.from(comparisonAudio.buffer, comparisonAudio.byteOffset, comparisonAudio.byteLength).equals(Buffer.from(editedAudio.buffer, editedAudio.byteOffset, editedAudio.byteLength))).toBe(true);
    const frames = await decode(comparePath, W, H * 2);
    const cy = Y + SIZE / 2;
    // Top half frozen on frame 24 during the freeze, then frame 25 + j.
    expect(near(rgb(frames[plan.freezeStart + 10], leftOf(24) + SIZE / 2, cy), RED)).toBe(true);
    expect(near(rgb(frames[plan.freezeStart + 10], leftOf(30) + SIZE - 2, cy), BLUE)).toBe(true);
    expect(near(rgb(frames[plan.freezeStart + plan.freezeFrames + 5], leftOf(30) + SIZE / 2, cy), RED)).toBe(true);
    const edited = await decode(out.file);
    for (let i = 0; i < frames.length; i++) {
      const sourceIndex = i < plan.freezeStart ? i : i < plan.freezeStart + plan.freezeFrames ? plan.triggerFrame : i - plan.freezeFrames;
      // Measured pixel bounds catch a duplicated/skipped frame at either join.
      expect(Math.abs(maskOf(frames[i]).box!.left - leftOf(sourceIndex))).toBeLessThanOrEqual(2);
      expect(near(rgb(frames[i], leftOf(sourceIndex) + 8, H + cy), rgb(edited[i], leftOf(sourceIndex) + 8, cy))).toBe(true);
    }
    for (const file of [out.file, comparePath]) {
      const times = JSON.parse(execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", file], { encoding: "utf8" })) as { frames: { best_effort_timestamp_time: string }[] };
      expect(times.frames).toHaveLength(72);
      times.frames.forEach((frame, index) => expect(Number(frame.best_effort_timestamp_time)).toBeCloseTo(index / FPS, 5));
    }
  });

  it.each([1000, 1500])("keeps every comparison frame at EOF with a %i ms freeze", async (freezeDurationMs) => {
    const source = path.join(work, "three-seconds.mp4");
    await ffmpeg(["-i", clip, "-vf", "tpad=stop_mode=clone:stop=24", "-af", "apad", "-t", "3", "-c:v", "libx264", "-c:a", "aac", source]);
    const pixels = await decode(source);
    expect(pixels).toHaveLength(72);
    const masks = pixels.map(maskOf);
    const longMedia = { ...media(), frameCount: 72, durationSeconds: 3 };
    const params = freezeParams({ trigger: { mode: "manual", timestampMs: 1500 }, freezeDurationMs });
    const dir = path.join(work, `comparison-eof-${freezeDurationMs}`);
    await mkdir(dir);
    const output = await renderVideo({ normalizedPath: source, media: longMedia, masks: { alphaAt: (index) => masks[index], subjectMotion: () => null }, params, outputDir: dir });
    const outputPath = path.join(dir, "output.mp4");
    const comparePath = path.join(dir, "compare.mp4");
    const frameCount = 72 + freezeDurationMs * FPS / 1000;
    const expected = { width: W, height: H * 2, fps: FPS, frameCount, hasAudio: true, timingToleranceSeconds: 1 / FPS };
    // The former mixed clocks lost the final frame intermittently as input
    // EOFs arrived in different orders. Exercise repeated actual encodes.
    for (let run = 0; run < 12; run++) {
      await renderComparison({ normalizedPath: source, outputPath, comparePath, width: W, height: H, background: "dark", freeze: { ...output.freeze!.plan, resume: true } });
      await verifyOutput(comparePath, expected);
    }
    const times = JSON.parse(execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", comparePath], { encoding: "utf8" })) as { frames: { best_effort_timestamp_time: string }[] };
    expect(times.frames).toHaveLength(frameCount);
    times.frames.forEach((frame, index) => expect(Number(frame.best_effort_timestamp_time)).toBeCloseTo(index / FPS, 5));
    expect(await pcm(comparePath)).toEqual(await pcm(outputPath));
  });

  it("refuses a freeze point where the subject has no mask", async () => {
    const masks = sourceMasks((index) => (index === 24 ? { data: new Uint8Array(W * H), box: null } : null));
    await expect(render("gap", freezeParams(), masks)).rejects.toMatchObject({ code: "tracking_unreliable" });
  });

  it("refuses echoes that would pile up on a subject that does not move", async () => {
    const masks = sourceMasks(() => alphas[24]);
    await expect(render("still", freezeParams(), masks)).rejects.toMatchObject({ code: "echoes_overlap" });
  });

  it("leaves out overlapping moments and says so", async () => {
    // 80 ms = 2 frames = 12 px apart on a 40 px subject: newer echoes cover too much of their neighbours.
    const out = await render("dense", freezeParams({ echo: { count: 6, spacingMs: 80, opacity: 0.85 } }));
    expect(out.freeze!.echoFrames.length).toBeGreaterThanOrEqual(2);
    expect(out.freeze!.echoFrames.length).toBeLessThan(6);
    expect(out.warnings.some((warning) => /overlapped/.test(warning))).toBe(true);
  });
});
