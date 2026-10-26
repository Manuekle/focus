import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { MediaToolError } from "../ffmpeg";

// Frame I/O through FFmpeg pipes. One RGBA frame in memory at a time (plus
// whatever an effect chooses to keep), so a clip never becomes a giant array.
// Every process is spawned with an argument array and killed on abort.

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

function start(args: readonly string[], signal?: AbortSignal): { child: ChildProcessWithoutNullStreams; stderr: () => string; done: Promise<void> } {
  const child = spawn(/*turbopackIgnore: true*/ FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-6000);
  });
  const kill = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", kill, { once: true });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (error) => reject(new MediaToolError(`ffmpeg could not start: ${error.message}`, stderr)));
    child.on("close", (code, killed) => {
      signal?.removeEventListener("abort", kill);
      if (code === 0) resolve();
      else reject(new MediaToolError(`ffmpeg exited with ${killed ?? code}`, stderr));
    });
  });
  return { child, stderr: () => stderr, done };
}

/** Yields exactly-sized RGBA frames from a video, in presentation order. */
export async function* readFrames(file: string, width: number, height: number, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const frameBytes = width * height * 4;
  const { child, done } = start(["-i", file, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgba", "-fps_mode", "passthrough", "pipe:1"], signal);
  // Surface process failures to the consumer even if it stops reading early.
  done.catch(() => undefined);
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending.push(chunk);
      pendingBytes += chunk.length;
      while (pendingBytes >= frameBytes) {
        const joined = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
        // Copy: the frame must not alias the buffer the next chunk extends.
        yield Buffer.from(joined.subarray(0, frameBytes));
        const rest = joined.subarray(frameBytes);
        pending = rest.length ? [rest] : [];
        pendingBytes = rest.length;
      }
    }
    await done;
    if (pendingBytes !== 0) throw new MediaToolError(`Decoder left ${pendingBytes} stray bytes`, "");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

export type FrameWriter = {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
};

/**
 * H.264/yuv420p encoder fed with RGBA frames at a constant rate. Audio, when
 * requested, is copied from `audioFrom` (the normalized source, already AAC),
 * so timing is shared with the frames it came with.
 */
export function writeFrames(options: {
  readonly output: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly audioFrom?: string;
  readonly signal?: AbortSignal;
}): FrameWriter {
  const { output, width, height, fps, frameCount, audioFrom, signal } = options;
  const args = [
    "-y",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "pipe:0",
    ...(audioFrom ? ["-i", audioFrom, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "copy"] : ["-map", "0:v:0", "-an"]),
    "-frames:v", String(frameCount),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high",
    // Untagged on both sides: decode and encode use the same default matrix,
    // so colors outside the effect round-trip unchanged.
    "-pix_fmt", "yuv420p",
    "-fps_mode", "cfr", "-r", String(fps),
    // Audio may be a few ms longer than the video track; never pad video for it.
    ...(audioFrom ? ["-shortest"] : []),
    "-movflags", "+faststart",
    output,
  ];
  const { child, done } = start(args, signal);
  done.catch(() => undefined);
  let failed: Error | null = null;
  child.stdin.on("error", (error) => {
    failed = error;
  });
  return {
    async write(frame) {
      if (failed) throw failed;
      if (!child.stdin.write(frame)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            child.stdin.off("close", onClose);
            resolve();
          };
          const onClose = () => {
            child.stdin.off("drain", onDrain);
            reject(failed ?? new MediaToolError("Encoder closed its input", ""));
          };
          child.stdin.once("drain", onDrain);
          child.stdin.once("close", onClose);
        });
      }
    },
    async finish() {
      child.stdin.end();
      await done;
    },
    abort() {
      child.kill("SIGKILL");
    },
  };
}

/** Runs a one-shot FFmpeg command that can be canceled. */
export async function runFfmpeg(args: readonly string[], signal?: AbortSignal): Promise<void> {
  const { child, done } = start(["-y", ...args], signal);
  child.stdin.end();
  await done;
}
