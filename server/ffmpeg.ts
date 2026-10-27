import { spawn } from "node:child_process";
import { z } from "zod";

// FFmpeg/FFprobe are always spawned with an argument array — never a shell —
// so a file name or any other value can never become part of a command.

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const DEFAULT_TIMEOUT_MS = 120_000;

export class MediaToolError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
    this.name = "MediaToolError";
  }
}

function run(bin: string, args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      // Keep the tail only; FFmpeg can be chatty on long encodes.
      stderr = (stderr + chunk.toString()).slice(-8_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new MediaToolError(`${bin} could not start: ${error.message}`, stderr));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new MediaToolError(`${bin} exited with ${signal ?? code}`, stderr));
    });
  });
}

const ProbeStreamSchema = z.object({
  codec_type: z.string(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  nb_frames: z.string().optional(),
  duration: z.string().optional(),
  start_time: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).loose().optional(),
  side_data_list: z.array(z.object({ rotation: z.number().optional() }).loose()).optional(),
}).loose();

export const ProbeSchema = z.object({
  streams: z.array(ProbeStreamSchema),
  format: z.object({
    format_name: z.string(),
    duration: z.string().optional(),
    size: z.string().optional(),
  }).loose(),
});
export type Probe = z.infer<typeof ProbeSchema>;
export type ProbeStream = z.infer<typeof ProbeStreamSchema>;

export async function probe(path: string): Promise<Probe> {
  const out = await run(FFPROBE, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ], 30_000);
  return ProbeSchema.parse(JSON.parse(out));
}

export function ffmpeg(args: readonly string[], timeoutMs?: number): Promise<string> {
  return run(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], timeoutMs);
}
