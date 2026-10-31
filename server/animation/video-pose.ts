import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { poseToolAvailable, runPoseTool, type PoseFile } from "../mapping/pose-estimator";
import { stabilizeTrack, type TrackedFrame } from "../mapping/source-track";
import { readJsonFile, writeAtomic } from "./store";

// The pose of the person in a movement video, at every tick of the 24 fps
// clock the flipbook uses (motion-reference.ts cuts the video into
// `samples/frame_NNNN.png`). RTMW whole-body in the worker's Python
// environment, steadied without changing its timing (left/right swaps undone,
// short dropouts bridged, jitter filtered). Measured once per movement
// reference and kept beside its samples; null when the pose tool isn't there
// or doesn't find a body in enough of the clip, and then every tick is drawn
// by Muse Image as before.

const CLOCK = 24;
/** A track with fewer found bodies than this share of the ticks isn't trusted. */
const MIN_FOUND = 0.8;

const TrackFileSchema = z.object({ ticks: z.number().int().positive(), frames: z.array(z.unknown()) });

const pending = ((globalThis as { __focusVideoPoseTracks?: Map<string, Promise<readonly TrackedFrame[] | null>> }).__focusVideoPoseTracks ??= new Map());

const found = (frame: TrackedFrame) => frame.scores.slice(5, 17).filter((score) => score > 0.3).length >= 8;

export function videoPoseTrack(dir: string, ticks: number): Promise<readonly TrackedFrame[] | null> {
  const file = path.join(dir, "pose-track.json");
  const running = pending.get(file);
  if (running) return running;
  const work = (async () => {
    const saved = await readJsonFile(file, (value) => TrackFileSchema.parse(value)).catch(() => null);
    if (saved) return saved.ticks === ticks && saved.frames.length === ticks ? (saved.frames as TrackedFrame[]) : null;
    if (!poseToolAvailable()) return null;
    const raw = path.join(dir, "poses.json");
    await runPoseTool(["detect", "--images", path.join(dir, "samples"), "--out", raw]).catch(() => undefined);
    const poses = await readFile(raw, "utf8").then((text) => JSON.parse(text) as PoseFile, () => null);
    if (!poses || poses.frames.length !== ticks) return null;
    const track = stabilizeTrack(poses.frames, { fps: CLOCK });
    const trusted = track.filter(found).length >= ticks * MIN_FOUND;
    await writeAtomic(file, JSON.stringify({ ticks, frames: trusted ? track : [] }));
    return trusted ? track : null;
  })();
  pending.set(file, work);
  void work.finally(() => pending.delete(file)).catch(() => undefined);
  return work;
}
