import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { VideoIdSchema, type VideoId } from "../shared/schemas";
import { AppError } from "./errors";

// Local, single-user storage for the MVP. Each upload owns one directory;
// ids are UUIDs validated before they ever touch a path.

export function dataRoot(): string {
  // Runtime data, not source: keep it out of Turbopack's file tracing.
  return path.resolve(/*turbopackIgnore: true*/ process.env.FOCUS_DATA_DIR ?? path.join(process.cwd(), ".focus-data"));
}

export const VIDEO_FILES = {
  source: (extension: string) => `source${extension}`,
  normalized: "normalized.mp4",
  poster: "poster.jpg",
  asset: "asset.json",
} as const;

export function parseVideoId(value: string): VideoId {
  const parsed = VideoIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("video_not_found", 404, "Ese video no existe o ya se eliminó.");
  return parsed.data;
}

export function videoDir(id: VideoId): string {
  return path.join(dataRoot(), "videos", parseVideoId(id));
}

export async function createVideoDir(id: VideoId): Promise<string> {
  const dir = videoDir(id);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeVideoDir(id: VideoId): Promise<void> {
  await rm(videoDir(id), { recursive: true, force: true });
}
