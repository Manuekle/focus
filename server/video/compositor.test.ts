import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BREAK_FRAME_CANVAS, RenderParamsSchema } from "../../shared/render";
import type { NormalizedMedia } from "../../shared/schemas";
import { ffmpeg, probe } from "../ffmpeg";
import { BACKGROUNDS, renderComparison, renderVideo, verifyOutput, type MaskSource } from "./compositor";
import { readFrames } from "./frames";
import { computeBreakFrameLayout, subjectMotion } from "./layout";

// End to end through real FFmpeg with a synthetic clip whose subject position
// is known exactly: a red square sliding right over a blue background. The
// mask source reproduces that geometry, so every expectation is pixel-exact.

const W = 320;
const H = 180;
const FPS = 24;
const FRAMES = 48;
const SIZE = 60;
// Measured from the generated clip: overlay draws frame i at x = 24 + 4i.
const xAt = (index: number) => 24 + index * 4;
const Y = 60;

let work: string;
let silent: string;
let withAudio: string;

const media = (hasAudio: boolean): NormalizedMedia => ({ width: W, height: H, fps: FPS, frameCount: FRAMES, durationSeconds: FRAMES / FPS, codec: "h264", hasAudio });

const masks: MaskSource = {
  alphaAt(index) {
    const data = new Uint8Array(W * H);
    const left = xAt(index);
    for (let y = Y; y < Y + SIZE; y++) data.fill(255, y * W + left, y * W + left + SIZE);
    return { data, box: { left, top: Y, right: left + SIZE, bottom: Y + SIZE } };
  },
  subjectMotion() {
    return subjectMotion(Array.from({ length: FRAMES }, (_, index) => ({ left: xAt(index), top: Y, right: xAt(index) + SIZE, bottom: Y + SIZE })));
  },
};

async function frameAt(file: string, width: number, height: number, index: number): Promise<Buffer> {
  let n = 0;
  for await (const frame of readFrames(file, width, height)) if (n++ === index) return frame;
  throw new Error("frame out of range");
}
const rgb = (frame: Buffer, width: number, x: number, y: number) => [...frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];
const near = (actual: number[], expected: readonly number[], tolerance = 24) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
const isGrayish = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b) <= 12;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-render-"));
  silent = path.join(work, "silent.mp4");
  withAudio = path.join(work, "audio.mp4");
  // overlay (not drawbox: there `t` means thickness) moves the square 4 px per frame.
  const inputs = ["-f", "lavfi", "-i", `color=c=0x1e3cd2:s=${W}x${H}:r=${FPS}:d=${FRAMES / FPS}`, "-f", "lavfi", "-i", `color=c=0xdc1e28:s=${SIZE}x${SIZE}:r=${FPS}:d=${FRAMES / FPS}`];
  const graph = ["-filter_complex", `[0:v][1:v]overlay=x='20+n*4':y=${Y}:eval=frame,format=yuv420p[v]`, "-map", "[v]"];
  await ffmpeg([...inputs, ...graph, "-c:v", "libx264", "-crf", "12", silent]);
  await ffmpeg([...inputs, "-f", "lavfi", "-i", `sine=frequency=440:duration=${FRAMES / FPS}`, ...graph, "-map", "2:a", "-c:v", "libx264", "-crf", "12", "-c:a", "aac", "-shortest", withAudio]);
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

async function render(name: string, raw: unknown, source = silent, hasAudio = false) {
  const outputDir = path.join(work, name);
  await (await import("node:fs/promises")).mkdir(outputDir, { recursive: true });
  const result = await renderVideo({ normalizedPath: source, media: media(hasAudio), masks, params: RenderParamsSchema.parse(raw), outputDir });
  return { ...result, file: path.join(outputDir, "output.mp4"), dir: outputDir };
}

describe("compositor", () => {
  it("Reality Shift: subject keeps its red, background turns gray, every frame", async () => {
    const out = await render("selective", { effect: "selective_color", feather: 0 });
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES, hasAudio: false });
    for (const index of [0, 24, 47]) {
      const frame = await frameAt(out.file, W, H, index);
      expect(near(rgb(frame, W, xAt(index) + SIZE / 2, Y + SIZE / 2), [220, 30, 40])).toBe(true);
      expect(isGrayish(rgb(frame, W, 5, 5))).toBe(true);
    }
    expect(out.framesWithoutMask).toBe(0);
  });

  it("Reality Shift: background blur keeps the subject sharp", async () => {
    const out = await render("blur", { effect: "background_blur", level: "high" });
    const frame = await frameAt(out.file, W, H, 24);
    expect(near(rgb(frame, W, xAt(24) + SIZE / 2, Y + SIZE / 2), [220, 30, 40])).toBe(true);
    // Far background stays the background color (no red smeared in).
    expect(near(rgb(frame, W, 5, 170), [30, 60, 210], 30)).toBe(true);
  });

  it("Motion Echo: earlier positions show the subject's trail, the present subject stays solid", async () => {
    const out = await render("echo", { effect: "motion_echo", trailCount: 3, trailSpacingMs: 125, intensity: 0.6, feather: 0 });
    const index = 40;
    const frame = await frameAt(out.file, W, H, index);
    const spacing = Math.round((125 * FPS) / 1000);
    // A point covered by the oldest trail only (3 × spacing frames ago).
    const oldX = xAt(index - 3 * spacing) + 2;
    const ghost = rgb(frame, W, oldX, Y + SIZE / 2);
    expect(ghost[0]).toBeGreaterThan(40);
    expect(ghost[0]).toBeLessThan(200);
    expect(near(rgb(frame, W, xAt(index) + SIZE / 2, Y + SIZE / 2), [220, 30, 40])).toBe(true);
    // Frame 0 has no history: identical to the source there.
    const first = await frameAt(out.file, W, H, 0);
    expect(near(rgb(first, W, 5, 5), [30, 60, 210])).toBe(true);
  });

  it("Spotlight: subject untouched, background darker away from the subject than beside it", async () => {
    const out = await render("spotlight", { effect: "spotlight", darkness: 0.9, feather: 0 });
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES, hasAudio: false });
    const index = 24;
    const frame = await frameAt(out.file, W, H, index);
    expect(near(rgb(frame, W, xAt(index) + SIZE / 2, Y + SIZE / 2), [220, 30, 40])).toBe(true);
    const beside = rgb(frame, W, xAt(index) + SIZE + 6, Y + SIZE / 2);
    const far = rgb(frame, W, W - 4, H - 4);
    expect(beside[2]).toBeGreaterThan(far[2] + 20);
    expect(far[2]).toBeLessThan(60);
  });

  it("Finish: subject glow lights the background next to the subject, letterbox bars are black", async () => {
    const out = await render("finish", { effect: "selective_color", feather: 0, finish: { subject: "glow", accent: "gold", accentStrength: 1, letterbox: true, vignette: 0.6 } });
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES, hasAudio: false });
    const plain = await render("finish-plain", { effect: "selective_color", feather: 0 });
    const index = 24;
    const [lit, base] = await Promise.all([frameAt(out.file, W, H, index), frameAt(plain.file, W, H, index)]);
    const beside = (frame: Buffer) => rgb(frame, W, xAt(index) + SIZE + 3, Y + SIZE / 2);
    // Gold glow: warmer and brighter than the plain gray background right there.
    expect(beside(lit)[0]).toBeGreaterThan(beside(base)[0] + 25);
    // The subject keeps its own color under the glow.
    expect(near(rgb(lit, W, xAt(index) + SIZE / 2, Y + SIZE / 2), [220, 30, 40])).toBe(true);
    // 320×180 cropped to 2.39:1 leaves bars of round((180 − 320/2.39) / 2) = 23 px.
    expect(near(rgb(lit, W, W / 2, 4), [0, 0, 0], 6)).toBe(true);
    expect(near(rgb(lit, W, W / 2, H - 4), [0, 0, 0], 6)).toBe(true);
  });

  it("Break the Frame: clipped background, unclipped subject past the frame edge", async () => {
    const out = await render("break", { effect: "break_frame", background: "dark", frameSize: "balanced", feather: 0 });
    const { width, height } = BREAK_FRAME_CANVAS;
    expect([out.width, out.height]).toEqual([width, height]);
    await verifyOutput(out.file, { width, height, fps: FPS, frameCount: FRAMES, hasAudio: false });
    const layout = computeBreakFrameLayout({ source: { width: W, height: H }, canvas: BREAK_FRAME_CANVAS, frameSize: "balanced", subject: masks.subjectMotion() });
    const { scale, offsetX, offsetY } = layout.transform;
    const frame = await frameAt(out.file, width, height, 24);
    const toCanvas = (x: number, y: number) => [Math.round(x * scale + offsetX), Math.round(y * scale + offsetY)];

    // Outside the frame, where the source has background, the canvas shows the composition color.
    const [bx, by] = toCanvas(5, layout.direction === "bottom" ? H - 3 : 3);
    if (by >= 0 && by < height && (by < layout.frame.y || by >= layout.frame.y + layout.frame.height)) {
      expect(near(rgb(frame, width, bx, by), BACKGROUNDS.dark)).toBe(true);
    }
    // Inside the frame, the video.
    const [ix, iy] = [layout.frame.x + 10, layout.frame.y + 10];
    expect(near(rgb(frame, width, ix, iy), [30, 60, 210], 30)).toBe(true);
    // The subject crosses the edge: red pixels outside the inner frame.
    let outside = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const inFrame = x >= layout.frame.x && x < layout.frame.x + layout.frame.width && y >= layout.frame.y && y < layout.frame.y + layout.frame.height;
        if (!inFrame && near(rgb(frame, width, x, y), [220, 30, 40], 40)) outside++;
      }
    }
    expect(outside).toBeGreaterThan(50);
    expect(out.breakoutFrameRatio).toBeGreaterThan(0.5);
  });

  it("Export: keeps audio when the source has it and builds a synced comparison stream", async () => {
    const out = await render("audio", { effect: "selective_color" }, withAudio, true);
    await verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES, hasAudio: true });
    const compare = path.join(out.dir, "compare.mp4");
    await renderComparison({ normalizedPath: withAudio, outputPath: out.file, comparePath: compare, width: W, height: H, background: "dark" });
    const facts = await probe(compare);
    const video = facts.streams.find((stream) => stream.codec_type === "video")!;
    expect([video.width, video.height, Number(video.nb_frames)]).toEqual([W, H * 2, FRAMES]);
  });

  it("Export: verification rejects a wrong frame count or missing audio", async () => {
    const out = await render("verify", { effect: "selective_color" });
    await expect(verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES + 1, hasAudio: false })).rejects.toMatchObject({ code: "export_invalid" });
    await expect(verifyOutput(out.file, { width: W, height: H, fps: FPS, frameCount: FRAMES, hasAudio: true })).rejects.toMatchObject({ code: "export_invalid" });
  });

  it("Square and portrait sources keep their geometry; Break the Frame always outputs 1080×1350", async () => {
    for (const [w, h] of [[240, 240], [180, 320]] as const) {
      const source = path.join(work, `src-${w}x${h}.mp4`);
      await ffmpeg(["-f", "lavfi", "-i", `color=c=0x1e3cd2:s=${w}x${h}:r=${FPS}:d=1`, "-f", "lavfi", "-i", `color=c=0xdc1e28:s=40x40:r=${FPS}:d=1`, "-filter_complex", "[0:v][1:v]overlay=x=60:y=80,format=yuv420p[v]", "-map", "[v]", "-c:v", "libx264", source]);
      const square: MaskSource = {
        alphaAt: () => {
          const data = new Uint8Array(w * h);
          for (let y = 80; y < 120; y++) data.fill(255, y * w + 60, y * w + 100);
          return { data, box: { left: 60, top: 80, right: 100, bottom: 120 } };
        },
        subjectMotion: () => subjectMotion([{ left: 60, top: 80, right: 100, bottom: 120 }]),
      };
      const mediaOf = { width: w, height: h, fps: FPS, frameCount: FPS, durationSeconds: 1, codec: "h264" as const, hasAudio: false };
      for (const raw of [{ effect: "selective_color" }, { effect: "break_frame" }]) {
        const outputDir = path.join(work, `geo-${w}-${raw.effect}`);
        await (await import("node:fs/promises")).mkdir(outputDir, { recursive: true });
        const out = await renderVideo({ normalizedPath: source, media: mediaOf, masks: square, params: RenderParamsSchema.parse(raw), outputDir });
        const expected = raw.effect === "break_frame" ? BREAK_FRAME_CANVAS : { width: w, height: h };
        expect([out.width, out.height]).toEqual([expected.width, expected.height]);
        await verifyOutput(path.join(outputDir, "output.mp4"), { ...expected, fps: FPS, frameCount: FPS, hasAudio: false });
      }
    }
  });

  it("Reports frames where the subject has no mask instead of inventing one", async () => {
    const gappy: MaskSource = {
      alphaAt: (index) => (index % 10 === 0 ? { data: new Uint8Array(W * H), box: null } : masks.alphaAt(index)),
      subjectMotion: masks.subjectMotion,
    };
    const outputDir = path.join(work, "gappy");
    await (await import("node:fs/promises")).mkdir(outputDir, { recursive: true });
    const result = await renderVideo({ normalizedPath: silent, media: media(false), masks: gappy, params: RenderParamsSchema.parse({ effect: "selective_color" }), outputDir });
    expect(result.framesWithoutMask).toBe(5);
    expect(result.warnings.join(" ")).toMatch(/5 de 48/);
  });

  it("Stops FFmpeg when the render is aborted", async () => {
    const controller = new AbortController();
    const outputDir = path.join(work, "abort");
    await (await import("node:fs/promises")).mkdir(outputDir, { recursive: true });
    const pending = renderVideo({
      normalizedPath: silent,
      media: media(false),
      masks,
      params: RenderParamsSchema.parse({ effect: "background_blur" }),
      outputDir,
      signal: controller.signal,
      onProgress: (fraction) => {
        if (fraction > 0.2) controller.abort();
      },
    });
    await expect(pending).rejects.toMatchObject({ code: "canceled" });
  });
});
