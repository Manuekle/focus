import path from "node:path";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import sharp from "sharp";
import { ENGINE_LABELS, MUSE_DRAWING_FPS, type AnimationJob, type ImportMethod } from "../../shared/reference-motion";
import { frameAt, type Tracking } from "../../shared/tracking";
import { segmentVideo } from "../ai/sam";
import { AppError } from "../errors";
import { ffmpeg, probe } from "../ffmpeg";
import { rasterizeSelection } from "../video/masks";
import { getFlipbook, updateFlipbook } from "../animation/store";
import { createFlipbook, importSequence, unsaveFlipbook } from "../animation/flipbooks";
import { storeCharacterImage } from "../animation/image-input";
import { applyMotionVideo } from "../animation/motion-reference";
import { outputFile } from "./jobs";
import { assetFiles, getOwnedAsset, getOwnedJob, jobFiles, root, updateJob } from "./store";

// A verified Reference Motion render opens in Flipbook. By default ("muse")
// the render is only the movement: it becomes the flipbook's video movement
// reference and Muse Image draws every frame from the character, each one
// guided by the render at its own tick (planning, budget confirmation,
// checks and redraws are Flipbook's). The engine's own frames can also be
// imported as they are, cut out by their flat background (free) or by one
// SAM 3.1 pass over the whole clip. Once per job and method: asking again
// opens the flipbook already made.

/** Replaceable in tests so no paid request ever runs there. */
export const services = { segment: segmentVideo };

/** SAM concepts tried in order; the second only when the first finds nothing. */
const CONCEPTS = ["person", "character"] as const;

const inflight = ((globalThis as { __focusMotionImports?: Map<string, Promise<string>> }).__focusMotionImports ??= new Map());

/** The route's paid-work guard. `continuation` is the second step of one Muse run: it spends no new generation. */
export type ImportGate = (frames: number, options?: { continuation?: boolean }) => Promise<void>;

export async function importToFlipbook(jobId: string, ownerId: string, method: ImportMethod = "muse", gate?: ImportGate): Promise<{ flipbookId: string }> {
  const job = await getOwnedJob(jobId, ownerId);
  if (job.status !== "completed") throw new AppError("job_not_completed", 409, "Only a finished render can be opened in Flipbook.");
  if (job.flipbookId && job.flipbookImport === method && (await getFlipbook(job.flipbookId).catch(() => null))) return { flipbookId: job.flipbookId };
  const key = `${job.id}:${method}`;
  const running = inflight.get(key);
  if (running) return { flipbookId: await running };
  const work = method === "muse" ? drawWithMuse(job, gate) : run(job, method, gate);
  inflight.set(key, work);
  try {
    return { flipbookId: await work };
  } finally {
    inflight.delete(key);
  }
}

/** The render, exactly the job's whole seconds at 24 fps (a short last frame is held), with its sound when it has one. */
async function exactClip(job: AnimationJob, file: string, withAudio: boolean): Promise<void> {
  const seconds = job.config.durationSeconds;
  await ffmpeg(["-protocol_whitelist", "file,pipe", "-i", outputFile(job, "animation.mp4"), "-map", "0:v:0", ...(withAudio ? ["-map", "0:a:0"] : []), "-vf", "fps=24,tpad=stop_mode=clone:stop_duration=1", "-t", String(seconds), "-frames:v", String(seconds * 24), "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", ...(withAudio ? ["-c:a", "aac", "-af", "apad"] : ["-an"]), file], 120_000);
}

/**
 * Muse Image draws the animation: a video-movement flipbook of the character,
 * whose movement reference is this render. The test engine's render is the
 * rigid character with the tracked skeleton drawn over it, so the plan is
 * told to follow the skeleton's joints.
 */
async function drawWithMuse(job: AnimationJob, gate?: ImportGate): Promise<string> {
  const seconds = job.config.durationSeconds;
  if (!Number.isInteger(seconds)) throw new AppError("import_mismatch", 422, "Flipbook sequences last whole seconds. Render a 1, 2 or 3 second segment.");
  const character = await getOwnedAsset(job.characterAssetId, job.ownerId).catch(() => {
    throw new AppError("asset_not_found", 410, "The character upload of this render has expired, so Muse Image has nothing to draw from.");
  });
  const image = await storeCharacterImage(await readFile(assetFiles.media(character)), character.originalName);
  const engine = ENGINE_LABELS[job.engine];
  const flipbook = await createFlipbook({
    imageId: image.id,
    ownerId: job.ownerId,
    prompt: `Follow the movement of the ${engine} render, one Muse Image drawing at a time.`,
    sequence: { durationSeconds: seconds, drawingFps: MUSE_DRAWING_FPS },
    motionSource: "video",
    motionNote: job.synthetic
      ? "The guide frames show a rigid stand-in of this character with a colored pose skeleton over it: the skeleton's joints are the performance. Ignore the stand-in's frozen limbs."
      : "The guide frames are a motion engine's render of this same character: take only the pose and timing from them, never their blur or artifacts.",
  }, async (cost) => gate?.(cost.estimatedFrames));
  await updateFlipbook(flipbook.id, (current) => ({ ...current, title: `${seconds} s · Muse Image from ${engine}`.slice(0, 80) }));
  const work = await mkdtemp(path.join(root(), "import-"));
  try {
    const clip = path.join(work, "render.mp4");
    const withAudio = Boolean(job.verification?.hasAudio);
    await exactClip(job, clip, withAudio);
    await applyMotionVideo(flipbook.id, clip, `${engine} render`, { durationSeconds: seconds, useAudio: withAudio }, async (cost) => gate?.(cost.estimatedFrames, { continuation: true }));
  } catch (error) {
    // A flipbook still waiting for its movement is no use to anyone: off the account, it expires.
    await unsaveFlipbook(flipbook.id, job.ownerId).catch(() => undefined);
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  await updateJob(job.id, (current) => ({ ...current, flipbookId: flipbook.id, flipbookImport: "muse" }), { evenIfFinished: true });
  return flipbook.id;
}

async function run(job: AnimationJob, segmentation: "background" | "sam", gate?: ImportGate): Promise<string> {
  const seconds = job.config.durationSeconds;
  if (!Number.isInteger(seconds)) throw new AppError("import_mismatch", 422, "Flipbook sequences last whole seconds. Render a 1, 2 or 3 second segment.");
  const character = await getOwnedAsset(job.characterAssetId, job.ownerId).catch(() => {
    throw new AppError("asset_not_found", 410, "The character upload of this render has expired, so it can’t be the flipbook’s reference.");
  });
  const expected = seconds * 24;
  if (segmentation === "sam") await gate?.(expected);
  const work = await mkdtemp(path.join(root(), "import-"));
  try {
    // The clip SAM sees and the frames cut from it are the same 24 fps file, so mask N is frame N.
    const clip = path.join(work, "clip.mp4");
    await exactClip(job, clip, false);
    await ffmpeg(["-protocol_whitelist", "file,pipe", "-i", clip, "-start_number", "0", path.join(work, "frame_%04d.png")], 120_000);
    const frames = (await readdir(work)).filter((name) => /^frame_\d{4}\.png$/.test(name)).sort().map((name) => path.join(work, name));
    if (frames.length !== expected) throw new AppError("import_mismatch", 422, `The render gave ${frames.length} of ${expected} frames.`);
    if (segmentation === "sam") await applyMasks(job, clip, frames);
    const audio = job.verification?.hasAudio ? path.join(work, "audio.m4a") : null;
    if (audio) await ffmpeg(["-protocol_whitelist", "file,pipe", "-i", outputFile(job, "animation.mp4"), "-vn", "-map", "0:a:0", "-c:a", "aac", audio]);
    const flipbook = await importSequence({
      ownerId: job.ownerId,
      title: `${ENGINE_LABELS[job.engine]} · ${seconds} s`,
      character: await readFile(assetFiles.media(character)),
      frames,
      sequence: { durationSeconds: seconds, drawingFps: 24 },
      importedFrom: { kind: "reference-motion", jobId: job.id, engine: job.engine, synthetic: job.synthetic },
      ...(audio && (await stat(audio).catch(() => null)) ? { audio: { file: audio, name: "Reference Motion soundtrack" } } : {}),
    });
    await updateJob(job.id, (current) => ({ ...current, flipbookId: flipbook.id, flipbookImport: segmentation }), { evenIfFinished: true });
    return flipbook.id;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * One SAM 3.1 pass over the clip; the object present longest (then largest)
 * is the character. Each frame keeps its pixels where the mask is and turns
 * transparent elsewhere. A frame SAM missed stays opaque: its cut-out then
 * falls back to the flat background, or fails on its own.
 */
async function applyMasks(job: AnimationJob, clip: string, frames: readonly string[]): Promise<void> {
  const facts = await probe(clip, true);
  const video = facts.streams.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new AppError("import_mismatch", 422, "The render couldn’t be read for segmentation.");
  const media = { width: video.width, height: video.height, fps: 24, frameCount: frames.length, durationSeconds: frames.length / 24, codec: "h264" as const, hasAudio: false };
  // Kept per job so a retry reuses the uploaded file id instead of paying for another upload.
  const dir = path.join(jobFiles.dir(job.id), "segmentation");
  await mkdir(dir, { recursive: true });
  let tracking: Tracking | null = null;
  for (const concept of CONCEPTS) {
    tracking = await services.segment({ id: `rm-${job.id}-${concept}`, videoId: job.id, videoDir: dir, normalizedPath: clip, media, prompt: { kind: "concept", concept } });
    if (tracking.objects.length) break;
  }
  const subject = [...(tracking?.objects ?? [])].sort((a, b) => b.framesPresent - a.framesPresent || b.meanArea - a.meanArea)[0];
  if (!tracking || !subject) throw new AppError("POSE_NOT_FOUND", 422, "SAM 3.1 found no character in this render. Open it with the background cut-out instead, or replace frames by hand.");
  const selection = new Set([subject.id]);
  for (const [index, file] of frames.entries()) {
    const mask = rasterizeSelection(frameAt(tracking, index), selection, media.width, media.height);
    if (!mask.box) continue;
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== media.width || info.height !== media.height) continue;
    for (let pixel = 0; pixel < mask.data.length; pixel++) data[pixel * 4 + 3] = mask.data[pixel];
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file);
  }
}
