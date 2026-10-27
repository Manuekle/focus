import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RenderParamsSchema, type RenderParamsOf } from "../../shared/render";
import { EditPlanSchema, PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH, VideoAssetSchema } from "../../shared/schemas";
import { echoOpacity, planFreeze, triggerProblem } from "../../shared/temporal";
import { suggestTemporalEvent } from "../../shared/temporal-events";
import { selectionTrack } from "../../shared/temporal-track";
import { TrackingSchema } from "../../shared/tracking";
import { META_DEFAULTS, readMetaConfig } from "../ai/meta";
import { interpretInstruction } from "../ai/planner";
import { segmentVideo, type SamPrompt } from "../ai/sam";
import { ffmpeg } from "../ffmpeg";
import { VIDEO_FILES, videoDir } from "../storage";
import { ingestVideo } from "../videos";
import { renderComparison, renderVideo, trackingMaskSource, verifyOutput } from "./compositor";
import { readFrames } from "./frames";
import { chooseEchoes } from "./temporal";

// Opt-in real footage + real Meta. One plan and one SAM pass on a 2–4 s
// excerpt, cached by input checksum/model/prompt. CPU-only replays are free.
// Run only this file; the existing live suite tests different v1 API work.
const SOURCE = process.env.FOCUS_TEMPORAL_LIVE_VIDEO;
const config = readMetaConfig();
const REPLAY_ONLY = process.env.FOCUS_TEMPORAL_LIVE_REPLAY === "true";
const models = { planner: config?.plannerModel ?? process.env.META_PLANNER_MODEL ?? META_DEFAULTS.plannerModel, segmentation: config?.segmentationModel ?? process.env.META_SEGMENTATION_MODEL ?? META_DEFAULTS.segmentationModel };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const instruction = z.string().trim().min(PROMPT_MIN_LENGTH).max(PROMPT_MAX_LENGTH).parse(process.env.FOCUS_TEMPORAL_LIVE_INSTRUCTION ?? "Congela un momento de la persona con abrigo negro a la derecha y deja tres ecos separados por 320 ms. Mantén el congelado un segundo y después continúa el video.");

async function cached<T>(file: string, schema: z.ZodType<T>, create: () => Promise<T>) {
  const saved = await readFile(file, "utf8").then((text) => schema.parse(JSON.parse(text))).catch(() => null);
  if (saved) return { value: saved, reused: true };
  if (REPLAY_ONLY) throw new Error(`Replay requires a cached artifact: ${file}`);
  const value = schema.parse(await create());
  await writeFile(file, JSON.stringify(value));
  return { value, reused: false };
}

async function capture(file: string, width: number, height: number, indices: readonly number[]) {
  const wanted = new Set(indices);
  const frames = new Map<number, Buffer>();
  let index = 0;
  for await (const frame of readFrames(file, width, height)) {
    if (wanted.has(index)) frames.set(index, frame);
    index++;
  }
  return { frames, count: index };
}

function meanError(a: Buffer, b: Buffer, exclude?: Uint8Array) {
  let sum = 0, count = 0;
  for (let pixel = 0; pixel < a.length / 4; pixel++) {
    if (exclude?.[pixel]) continue;
    for (let channel = 0; channel < 3; channel++) sum += Math.abs(a[pixel * 4 + channel] - b[pixel * 4 + channel]);
    count += 3;
  }
  return sum / Math.max(1, count);
}

describe.skipIf(!SOURCE || (!config && !REPLAY_ONLY))("Time Freeze + Echo (real footage, live Meta)", () => {
  it("plans, tracks a real person, exports genuine cutouts and preserves all v1 effects", async () => {
    const seconds = z.coerce.number().min(2).max(4).parse(process.env.FOCUS_TEMPORAL_LIVE_SECONDS ?? 3);
    const start = z.coerce.number().min(0).parse(process.env.FOCUS_TEMPORAL_LIVE_START ?? 0);
    const timestampMs = z.coerce.number().int().nonnegative().parse(process.env.FOCUS_TEMPORAL_LIVE_TRIGGER_MS ?? 1500);
    const point = process.env.FOCUS_TEMPORAL_LIVE_POINT
      ? z.tuple([z.coerce.number().min(0).max(1), z.coerce.number().min(0).max(1)]).parse(process.env.FOCUS_TEMPORAL_LIVE_POINT.split(","))
      : null;
    const sourceHash = hash(await readFile(SOURCE!));
    const root = path.resolve(".focus-data", "phase8", hash(`${sourceHash}|${start}|${seconds}`).slice(0, 16));
    await mkdir(root, { recursive: true });
    vi.stubEnv("FOCUS_DATA_DIR", path.join(root, "data"));
    vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", "true");
    const report: Record<string, unknown> = { status: "running", startedAt: new Date().toISOString(), source: SOURCE, sourceSha256: sourceHash, start, seconds, point, models };
    const save = () => writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2));
    await save();
    console.info(`[phase8] Artifacts: ${root}`);
    try {
      const asset = await cached(path.join(root, "asset.json"), VideoAssetSchema, async () => {
        const clip = path.join(root, "excerpt.mp4");
        await ffmpeg(["-ss", String(start), "-t", String(seconds), "-i", SOURCE!, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", clip]);
        return ingestVideo({ body: Readable.toWeb(Readable.from(await readFile(clip))) as ReadableStream<Uint8Array>, fileName: "real-person.mp4" });
      });
      const video = asset.value;
      const media = video.normalized;
      expect(media.frameCount).toBeLessThanOrEqual(96);
      expect(triggerProblem({ mode: "manual", timestampMs }, media)).toBeNull();
      const input = path.join(videoDir(video.id), VIDEO_FILES.normalized);
      console.info("[phase8] Muse Spark temporal plan (cached when available)");
      const planned = await cached(path.join(root, `plan-${hash(`${instruction}|${models.planner}`).slice(0, 16)}.json`), EditPlanSchema, () => interpretInstruction({ request: { videoId: video.id, effect: "time-freeze", prompt: instruction }, posterPath: path.join(videoDir(video.id), VIDEO_FILES.poster), media }));
      expect(planned.value).toMatchObject({ supported: true, effect: "time_freeze_echo", needsClarification: false });
      expect(planned.value.parameters).not.toHaveProperty("timestampMs");
      const prompt: SamPrompt = point
        ? { kind: "point", objectId: 0, frameIndex: 0, point: { x: Math.min(media.width - 1, Math.round(point[0] * media.width)), y: Math.min(media.height - 1, Math.round(point[1] * media.height)) } }
        : { kind: "concept", concept: planned.value.target.concept };
      const trackingId = `live-${hash(`${JSON.stringify(prompt)}|${models.segmentation}`).slice(0, 16)}`;
      report.media = media;
      report.plan = planned.value;
      await save();
      console.info(`[phase8] SAM 3.1: ${media.frameCount} normalized frames, ${prompt.kind} prompt (cached when available)`);
      let lastProgress = 0;
      const segmented = await cached(path.join(root, `${trackingId}.json`), TrackingSchema, () => segmentVideo({
        id: trackingId, videoId: video.id, videoDir: videoDir(video.id), normalizedPath: input, media, prompt,
        signal: AbortSignal.timeout(240_000),
        onProgress: (fraction) => {
          if (fraction >= lastProgress + 0.25 || (fraction === 1 && lastProgress !== 1)) { console.info(`[phase8] SAM ${Math.round(fraction * media.frameCount)}/${media.frameCount} frames`); lastProgress = fraction; }
        },
      }));
      const tracking = segmented.value;
      expect(tracking.outcome.status).toBe("completed");
      expect(tracking.objects.length).toBeGreaterThan(0);
      const selected = [...tracking.objects].sort((a, b) => b.framesPresent * b.meanArea - a.framesPresent * a.meanArea)[0].id;
      const track = selectionTrack(tracking, [selected]);
      report.reused = { source: asset.reused, plan: planned.reused, segmentation: segmented.reused };
      report.mode = !planned.reused || !segmented.reused ? "live-api" : "cached-replay";
      report.tracking = { objectId: selected, maskedFrames: track.filter((p) => p.masked).length, objects: tracking.objects, videoFramesProcessed: tracking.videoFramesProcessed, outcome: tracking.outcome };
      report.suggestions = { jump_apex: suggestTemporalEvent(track, "jump_apex", media), peak_motion: suggestTemporalEvent(track, "peak_motion", media) };
      await save();
      expect(track.filter((p) => p.masked).length).toBeGreaterThanOrEqual(media.frameCount * 0.8);
      for (const point of track) {
        expect(point.timestamp).toBeCloseTo(point.frameIndex / media.fps, 8);
        expect(point.frameIndex).toBeLessThan(media.frameCount);
        expect(point.box.left).toBeGreaterThanOrEqual(0);
        expect(point.box.top).toBeGreaterThanOrEqual(0);
        expect(point.box.right).toBeLessThanOrEqual(media.width);
        expect(point.box.bottom).toBeLessThanOrEqual(media.height);
      }
      const masks = trackingMaskSource(tracking, [selected], media);
      const params = RenderParamsSchema.parse({ effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs }, freezeDurationMs: 1000, echo: { count: 3, spacingMs: 320, opacity: 0.8 }, feather: 0 }) as RenderParamsOf<"time_freeze_echo">;
      const timeline = planFreeze(params, media);
      const chosen = chooseEchoes(masks, media, timeline);
      expect(chosen.echoFrames.length).toBeGreaterThanOrEqual(2);
      report.temporal = { params, timeline, echoFrames: chosen.echoFrames, warnings: chosen.warnings };
      await save();
      const usageFile = path.join(root, "data", "usage.jsonl");
      const usageBefore = await readFile(usageFile, "utf8").catch(() => "");
      const dir = path.join(root, "time-freeze");
      await mkdir(dir, { recursive: true });
      console.info("[phase8] Rendering Time Freeze from saved masks");
      const output = await renderVideo({ normalizedPath: input, media, masks, params, outputDir: dir });
      report.render = { frameCount: output.frameCount, echoFrames: output.freeze?.echoFrames, warnings: output.warnings };
      await save();
      const file = path.join(dir, "output.mp4");
      const expected = { width: media.width, height: media.height, fps: media.fps, frameCount: timeline.outputFrameCount, hasAudio: media.hasAudio, timingToleranceSeconds: Math.max(1 / media.fps, 1024 / 48000) };
      await verifyOutput(file, expected);
      await renderComparison({ normalizedPath: input, outputPath: file, comparePath: path.join(dir, "compare.mp4"), width: media.width, height: media.height, background: "dark", freeze: { ...timeline, resume: true } });
      await verifyOutput(path.join(dir, "compare.mp4"), { ...expected, height: media.height * 2 });

      const resume = timeline.freezeStart + timeline.freezeFrames;
      const source = await capture(input, media.width, media.height, [0, timeline.triggerFrame, timeline.triggerFrame + 1, media.frameCount - 1, ...chosen.echoFrames]);
      const edited = await capture(file, media.width, media.height, [0, timeline.triggerFrame, timeline.freezeStart, resume - 1, resume, timeline.outputFrameCount - 1]);
      expect(source.count).toBe(media.frameCount);
      expect(edited.count).toBe(timeline.outputFrameCount);
      const base = source.frames.get(timeline.triggerFrame)!;
      const hold = edited.frames.get(resume - 1)!;
      const baseAlpha = masks.alphaAt(timeline.triggerFrame);
      const alphas = chosen.echoFrames.map((frame) => masks.alphaAt(frame));
      const union = new Uint8Array(baseAlpha.data);
      alphas.forEach((alpha) => alpha.data.forEach((value, pixel) => { if (value) union[pixel] = 255; }));
      const errors = {
        before: meanError(edited.frames.get(0)!, source.frames.get(0)!),
        trigger: meanError(edited.frames.get(timeline.triggerFrame)!, base),
        backgroundDuringFreeze: meanError(hold, base, union),
        firstResumed: meanError(edited.frames.get(resume)!, source.frames.get(timeline.triggerFrame + 1)!),
        last: meanError(edited.frames.get(timeline.outputFrameCount - 1)!, source.frames.get(media.frameCount - 1)!),
      };
      report.pixelMeanErrors = errors;
      await save();
      Object.values(errors).forEach((error) => expect(error).toBeLessThan(6));
      for (let rank = 0; rank < chosen.echoFrames.length; rank++) {
        const alpha = alphas[rank];
        const pixels = source.frames.get(chosen.echoFrames[rank])!;
        let foreground = 0, best = -1, contrast = 0;
        for (let pixel = 0; pixel < alpha.data.length; pixel++) {
          if (!alpha.data[pixel]) continue;
          foreground++;
          if (baseAlpha.data[pixel] || alphas.some((a, i) => i !== rank && a.data[pixel])) continue;
          const x = pixel % media.width, y = Math.floor(pixel / media.width);
          if (x < 2 || y < 2 || x >= media.width - 2 || y >= media.height - 2) continue;
          if (![pixel - 2, pixel + 2, pixel - media.width * 2, pixel + media.width * 2].every((p) => alpha.data[p])) continue;
          const delta = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(pixels[pixel * 4 + channel] - base[pixel * 4 + channel]), 0);
          if (delta > contrast) { best = pixel; contrast = delta; }
        }
        expect(foreground).toBeGreaterThan(0);
        expect(foreground / ((alpha.box!.right - alpha.box!.left) * (alpha.box!.bottom - alpha.box!.top))).toBeLessThan(0.95);
        expect(best).toBeGreaterThanOrEqual(0);
        const opacity = echoOpacity(rank, chosen.echoFrames.length, params.echo.opacity);
        for (let channel = 0; channel < 3; channel++) {
          const at = best * 4 + channel;
          expect(Math.abs(hold[at] - (base[at] + (pixels[at] - base[at]) * opacity))).toBeLessThan(32);
          if (rank > 0) expect(Math.abs(edited.frames.get(timeline.freezeStart)![at] - base[at])).toBeLessThan(32);
        }
        if (rank === 0) {
          const cutout = Buffer.from(pixels);
          alpha.data.forEach((value, pixel) => {
            if (!value) cutout.fill(0, pixel * 4, pixel * 4 + 3);
            cutout[pixel * 4 + 3] = value;
          });
          await sharp(alpha.data, { raw: { width: media.width, height: media.height, channels: 1 } }).png().toFile(path.join(root, "sam-mask.png"));
          await sharp(cutout, { raw: { width: media.width, height: media.height, channels: 4 } }).png().toFile(path.join(root, "subject-cutout.png"));
        }
      }
      for (const [name, frame] of [["before", source.frames.get(0)!], ["freeze", hold], ["resumed", edited.frames.get(resume)!]] as const) await sharp(frame, { raw: { width: media.width, height: media.height, channels: 4 } }).png().toFile(path.join(root, `${name}.png`));

      const variants: Record<string, unknown>[] = [];
      for (const effect of ["selective_color", "background_blur", "spotlight", "break_frame", "motion_echo"] as const) {
        console.info(`[phase8] v1 regression: ${effect}`);
        const outputDir = path.join(root, effect);
        await mkdir(outputDir, { recursive: true });
        const rendered = await renderVideo({ normalizedPath: input, media, masks, params: RenderParamsSchema.parse({ effect }), outputDir });
        await verifyOutput(path.join(outputDir, "output.mp4"), { width: rendered.width, height: rendered.height, fps: media.fps, frameCount: media.frameCount, hasAudio: media.hasAudio });
        variants.push({ effect, width: rendered.width, height: rendered.height, frameCount: rendered.frameCount, warnings: rendered.warnings });
      }
      const rerenderDir = path.join(root, "time-freeze-adjusted");
      await mkdir(rerenderDir, { recursive: true });
      const adjusted = await renderVideo({ normalizedPath: input, media, masks, params: { ...params, freezeDurationMs: 500, echo: { ...params.echo, count: 2 } }, outputDir: rerenderDir });
      await verifyOutput(path.join(rerenderDir, "output.mp4"), { ...expected, frameCount: adjusted.frameCount });
      expect(await readFile(usageFile, "utf8").catch(() => "")).toBe(usageBefore);
      report.v1 = variants;
      report.rerenderWithoutMetaCalls = true;
      report.usage = usageBefore.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      report.status = "passed";
      report.finishedAt = new Date().toISOString();
      await save();
      if (report.mode === "live-api") await writeFile(path.join(root, "live-capture-report.json"), JSON.stringify(report, null, 2));
      console.info(`[phase8] Verified: ${chosen.echoFrames.length} genuine echoes; report ${path.join(root, "report.json")}`);
    } catch (error) {
      report.status = "failed";
      report.error = error instanceof Error ? error.name : "unknown";
      await save();
      throw error;
    } finally {
      vi.unstubAllEnvs();
    }
  }, 300_000);

  it.skipIf(!process.env.FOCUS_TEMPORAL_LIVE_REJECTED_TRACKING)("rejects a recorded background selection instead of inventing echoes", async () => {
    const file = path.resolve(process.env.FOCUS_TEMPORAL_LIVE_REJECTED_TRACKING!);
    const root = path.dirname(file);
    const tracking = TrackingSchema.parse(JSON.parse(await readFile(file, "utf8")));
    const video = VideoAssetSchema.parse(JSON.parse(await readFile(path.join(root, "asset.json"), "utf8")));
    expect(tracking.videoId).toBe(video.id);
    const params = RenderParamsSchema.parse({ effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1500 }, echo: { count: 3, spacingMs: 320 } }) as RenderParamsOf<"time_freeze_echo">;
    const attempt = async () => chooseEchoes(trackingMaskSource(tracking, [tracking.objects[0].id], video.normalized), video.normalized, planFreeze(params, video.normalized));
    await expect(attempt()).rejects.toMatchObject({ code: "echoes_overlap" });
    await writeFile(path.join(root, "background-rejection.json"), JSON.stringify({ status: "passed", source: "recorded-live-SAM", tracking: path.basename(file), prompt: tracking.prompt, frames: tracking.frames.length, expectedError: "echoes_overlap" }, null, 2));
  });
});
