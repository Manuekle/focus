import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Synthetic, rights-free fixtures generated with FFmpeg on every run. */
export default function globalSetup() {
  const dir = path.join(import.meta.dirname, ".fixtures");
  rmSync(path.join(import.meta.dirname, "..", ".focus-data-e2e"), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    path.join(dir, "clip.mp4"),
  ]);
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=12",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    path.join(dir, "long.mp4"),
  ]);
  writeFileSync(path.join(dir, "broken.mp4"), "this is not a video");
}
