import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { ffmpeg } from "../ffmpeg";

// Step 1 of the rotoscope: every source frame at a fixed rate, letterbox removed.
// Frames are numbered from 1 like the user's own export (…_001.png).

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

export type Crop = { readonly width: number; readonly height: number; readonly x: number; readonly y: number };

export const frameName = (index: number) => `frame_${String(index).padStart(4, "0")}.png`;

/** Most frequent crop FFmpeg's cropdetect proposes over the clip: the black bars of a screen recording. */
export async function detectCrop(video: string, start: number, seconds: number): Promise<Crop | null> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostdin", "-ss", String(start), "-t", String(seconds), "-i", video, "-vf", "cropdetect=24:2:0", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  return mostFrequentCrop(stderr);
}

export function mostFrequentCrop(log: string): Crop | null {
  const counts = new Map<string, number>();
  for (const match of log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return null;
  const [width, height, x, y] = best.slice(5).split(":").map(Number);
  return { width, height, x, y };
}

export async function extractFrames(input: { video: string; out: string; fps: number; start: number; seconds?: number; crop: Crop | null }): Promise<number> {
  await mkdir(input.out, { recursive: true });
  const filters = [`fps=${input.fps}`, ...(input.crop ? [`crop=${input.crop.width}:${input.crop.height}:${input.crop.x}:${input.crop.y}`] : [])];
  await ffmpeg([
    "-ss", String(input.start),
    ...(input.seconds ? ["-t", String(input.seconds)] : []),
    "-i", input.video,
    "-map", "0:v:0",
    "-vf", filters.join(","),
    "-start_number", "1",
    path.join(input.out, "frame_%04d.png"),
  ], 600_000);
  return (await readdir(input.out)).filter((name) => /^frame_\d{4}\.png$/.test(name)).length;
}
