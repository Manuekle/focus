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
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x1e3cd2:s=320x180:r=24:d=3",
    "-f", "lavfi", "-i", "color=c=0xdc1e28:s=40x40:r=24:d=3",
    "-f", "lavfi", "-i", "aevalsrc=0.1*sin(2*PI*(220*t+330*t*t)):s=48000:d=3",
    "-filter_complex", "[0:v][1:v]overlay=x='8+n*4':y='100-70*max(0,1-pow((n-36)/20,2))':eval=frame,format=yuv420p[v]",
    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-crf", "12", "-c:a", "aac", "-ac", "2", "-shortest", path.join(dir, "jump.mp4"),
  ]);
}
