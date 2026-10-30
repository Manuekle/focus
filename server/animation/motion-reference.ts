import path from "node:path";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { z } from "zod";
import { MotionReferenceSchema, type MotionReference } from "../../shared/sequence";
import { AppError } from "../errors";
import { ffmpeg, probe } from "../ffmpeg";
import { SERVER_MAX_UPLOAD_BYTES } from "../media-limits";
import { describeSource, normalizedDimensions } from "../media-validation";
import { flipbookDir, getFlipbook, updateFlipbook, isRunning } from "./store";
import { mediaLimiter, receiveMedia } from "./media-input";
import { reviseSequence } from "./flipbooks";
import { guideTrack } from "./motion-registration";
import { normalizeTrack, trackPath } from "./flipbook-audio";
import type { PaidWorkGate } from "../jobs";

const mediaLocks = ((globalThis as { __focusMotionLocks?: Map<string, Promise<unknown>> }).__focusMotionLocks ??= new Map());
const runMedia = (args: string[], timeout?: number) => mediaLimiter.run(() => ffmpeg(args, timeout));

export function motionDir(id: string, version: string): string {
  if (!/^[0-9a-f]{12}$/.test(version)) throw new AppError("motion_not_found", 404, "This movement reference is no longer available.");
  return path.join(flipbookDir(id), "motion", version);
}
export async function motionGuide(id: string, reference: MotionReference, tick: number): Promise<Buffer | null> {
  if (!Number.isInteger(tick) || tick < 0 || tick >= reference.durationSeconds * 24) return null;
  return readFile(path.join(motionDir(id, reference.version), "samples", `frame_${String(tick).padStart(4, "0")}.png`)).catch(() => null);
}

export async function uploadMotionReference(id: string, body: ReadableStream<Uint8Array> | null, bytes: number | undefined, name: string) {
  await getFlipbook(id);
  const version = randomBytes(6).toString("hex");
  const dir = motionDir(id, version);
  const raw = path.join(dir, "upload.mov");
  await receiveMedia(body, bytes, raw, SERVER_MAX_UPLOAD_BYTES, true);
  try { return await adoptMotionVideo(id, version, raw, name); }
  catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  finally { await rm(raw, { force: true }); }
}

/** Normalizes a video on disk into this flipbook's movement draft; the file itself is left as it was. */
async function adoptMotionVideo(id: string, version: string, raw: string, name: string) {
  const dir = motionDir(id, version);
  const source = describeSource(await probe(raw, true), (await stat(raw)).size);
  if (source.durationSeconds < 1) throw new AppError("motion_too_short", 422, "Choose a reference video at least one second long.");
  const size = normalizedDimensions(source.width, source.height);
  await runMedia(["-protocol_whitelist", "file,pipe", "-i", raw, "-map", "0:v:0", ...(source.hasAudio ? ["-map", "0:a:0"] : []), "-vf", `scale=${size.width}:${size.height},fps=24,setsar=1`, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", ...(source.hasAudio ? ["-c:a", "aac", "-ac", "2"] : ["-an"]), "-movflags", "+faststart", path.join(dir, "source.mp4")], Math.max(120_000, Math.ceil(source.durationSeconds) * 10_000));
  const draft = MotionReferenceSchema.parse({ version, name: path.basename(name).slice(0, 120) || "Movement reference", sourceSeconds: source.durationSeconds, start: 0, durationSeconds: Math.min(20, Math.floor(source.durationSeconds)), hasAudio: source.hasAudio });
  return updateFlipbook(id, (current) => ({ ...current, motionDraft: draft }), { evenIfCanceled: true });
}

/**
 * A video Focus already holds (a Reference Motion render) becomes the whole
 * movement reference of a flipbook waiting for one: the same draft and apply
 * steps as an upload, so every frame is still drawn by Muse Image, guided by
 * this video at its own tick.
 */
export async function applyMotionVideo(id: string, file: string, name: string, options: { durationSeconds: number; useAudio: boolean }, gate?: PaidWorkGate) {
  const version = randomBytes(6).toString("hex");
  await mkdir(motionDir(id, version), { recursive: true });
  try { await adoptMotionVideo(id, version, file, name); }
  catch (error) { await rm(motionDir(id, version), { recursive: true, force: true }); throw error; }
  return attachMotionReference(id, { version, start: 0, durationSeconds: options.durationSeconds, useAudio: options.useAudio }, gate);
}

export const AttachMotionSchema = z.object({ version: z.string().regex(/^[0-9a-f]{12}$/), start: z.number().min(0), durationSeconds: z.number().int().min(1).max(20), useAudio: z.boolean().default(false) });
export async function attachMotionReference(id: string, asked: z.input<typeof AttachMotionSchema>, gate?: PaidWorkGate) {
  const previous = mediaLocks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => attachMotionUnlocked(id, asked, gate));
  mediaLocks.set(id, next);
  try { return await next; }
  finally { if (mediaLocks.get(id) === next) mediaLocks.delete(id); }
}
async function attachMotionUnlocked(id: string, asked: z.input<typeof AttachMotionSchema>, gate?: PaidWorkGate) {
  const input = AttachMotionSchema.parse(asked);
  const source = await getFlipbook(id);
  if (isRunning(id)) throw new AppError("flipbook_busy", 409, "Wait for the current animation step to finish.");
  const original = [source.motionDraft, source.motionReference].find((entry) => entry?.version === input.version);
  if (!original || input.start + input.durationSeconds > original.sourceSeconds + 0.001) throw new AppError("invalid_motion_trim", 400, "Choose a whole-second segment inside your reference video.");
  const version = randomBytes(6).toString("hex");
  const dir = motionDir(id, version);
  const samples = path.join(dir, "samples");
  await mkdir(samples, { recursive: true });
  try {
    await copyFile(path.join(motionDir(id, original.version), "source.mp4"), path.join(dir, "source.mp4"));
    await runMedia(["-protocol_whitelist", "file,pipe", "-ss", String(input.start), "-i", path.join(dir, "source.mp4"), "-t", String(input.durationSeconds), "-map", "0:v:0", "-vf", "fps=24,scale=512:512:force_original_aspect_ratio=decrease", "-frames:v", String(input.durationSeconds * 24), "-start_number", "0", path.join(samples, "frame_%04d.png")]);
    if ((await readdir(samples)).filter((name) => /^frame_\d{4}\.png$/.test(name)).length !== input.durationSeconds * 24) throw new AppError("motion_incomplete", 422, "The selected segment could not provide every motion sample. Choose a shorter segment.");
    // Measured now, while the movement is planned, so registering the first drawings doesn't wait for it.
    void guideTrack(dir, input.durationSeconds * 24, id).catch(() => undefined);
    const reference = { ...original, version, start: input.start, durationSeconds: input.durationSeconds };
    let audio: import("../../shared/sequence").FlipbookAudio | undefined;
    if (input.useAudio && original.hasAudio) {
      const audioVersion = randomBytes(6).toString("hex");
      const target = trackPath(id, audioVersion);
      await mkdir(path.dirname(target), { recursive: true });
      const trimmed = path.join(dir, "trim-audio.m4a");
      await runMedia(["-protocol_whitelist", "file,pipe", "-ss", String(input.start), "-i", path.join(dir, "source.mp4"), "-t", String(input.durationSeconds), "-vn", "-c:a", "aac", trimmed]);
      const durationSeconds = await normalizeTrack(trimmed, target);
      await rm(trimmed, { force: true });
      audio = { version: audioVersion, name: original.name, durationSeconds, offset: 0, startsAt: 0, volume: 1 };
    }
    return await reviseSequence(id, { durationSeconds: input.durationSeconds, drawingFps: source.sequence?.drawingFps ?? 24 }, gate, { reference, guide: (tick) => motionGuide(id, reference, tick), audio });
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
