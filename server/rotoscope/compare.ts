import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, symlink } from "node:fs/promises";
import sharp from "sharp";
import { COMPARE_SIZES, type CompareOptions, type CompareResult } from "../../shared/rotoscope";
import { AppError } from "../errors";
import { ffmpeg } from "../ffmpeg";

// The comparison clip: the run's video frames and its approved drawings in one file, side by side or stacked.
// Each picture keeps its own proportions; they share a height (side by side) or a width (stacked), and the
// drawings, which are transparent, sit on a flat background because a clip has no transparency.

export type Panel = { readonly width: number; readonly height: number };
export type CompareGeometry = { readonly video: Panel; readonly drawing: Panel; readonly canvas: Panel };
/** A frame of the clip: its video frame and its approved drawing, as files. */
export type CompareFrame = { readonly index: number; readonly source: string; readonly drawing: string };

/** Bump when the encode changes, so clips rendered the old way are not served for the new one. */
const VERSION = 1;
const KEEP = 8;
const BACKGROUND = { white: "0xffffff", dark: "0x111214" } as const;
const NAME = /^[0-9a-f]{16}\.(mp4|mov|webm|gif)$/;
const TYPE: Record<CompareOptions["format"], string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", gif: "image/gif" };
/** One render at a time per clip: a second click while it renders waits for the first instead of encoding twice. */
const rendering = new Map<string, Promise<void>>();

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** The two pictures at one height (side by side) or one width (stacked), the whole clip's longest side being `size` pixels. */
export function compareGeometry(layout: CompareOptions["layout"], source: Panel, drawing: Panel, size: number): CompareGeometry {
  const side = layout === "side";
  // Panels at a common height (or width) of 1, then scaled to the asked size.
  const video = side ? { width: source.width / source.height, height: 1 } : { width: 1, height: source.height / source.width };
  const art = side ? { width: drawing.width / drawing.height, height: 1 } : { width: 1, height: drawing.height / drawing.width };
  const scale = size / Math.max(side ? video.width + art.width : 1, side ? 1 : video.height + art.height);
  const panel = (unit: Panel): Panel => ({ width: even(unit.width * scale), height: even(unit.height * scale) });
  const [v, d] = [panel(video), panel(art)];
  // The shared side is the same number in both, whatever each one's rounding said.
  const shared = side ? { height: Math.max(v.height, d.height) } : { width: Math.max(v.width, d.width) };
  const fitted = { video: { ...v, ...shared }, drawing: { ...d, ...shared } };
  return { ...fitted, canvas: side ? { width: fitted.video.width + fitted.drawing.width, height: fitted.video.height } : { width: fitted.video.width, height: fitted.video.height + fitted.drawing.height } };
}

/** Drawings are held for whole frames of the clip: a 9-per-second run plays at 27, so none lasts longer than another. GIFs keep the run's own rate. */
export function compareRate(fps: number, format: CompareOptions["format"]): number {
  return format === "gif" ? fps : fps * Math.max(1, Math.ceil(24 / fps));
}

/** FFmpeg's arguments for a clip whose frames are `v_00001.png` and `d_00001.png` in `work`. */
export function compareArgs(input: { readonly work: string; readonly out: string; readonly fps: number; readonly frames: number; readonly geometry: CompareGeometry; readonly options: CompareOptions; readonly sound: string | null }): string[] {
  const { work, out, fps, frames, geometry, options, sound } = input;
  const { video, drawing } = geometry;
  const rate = compareRate(fps, options.format);
  const stack = options.layout === "side" ? "hstack" : "vstack";
  const order = options.first === "video" ? "[v][d]" : "[d][v]";
  const graph = [
    `[0:v]scale=${video.width}:${video.height}:flags=lanczos,setsar=1,format=yuv420p[v]`,
    `color=c=${BACKGROUND[options.background]}:s=${drawing.width}x${drawing.height}:r=${fps}[bg]`,
    `[1:v]scale=${drawing.width}:${drawing.height}:flags=lanczos,format=rgba[art]`,
    `[bg][art]overlay=format=auto:shortest=1,format=yuv420p[d]`,
    options.format === "gif"
      ? `${order}${stack}=inputs=2:shortest=1,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[out]`
      // The last drawing is held like the others: a frame has no length until another follows it, so one is added to end on.
      : `${order}${stack}=inputs=2:shortest=1,tpad=stop_mode=clone:stop=1,fps=${rate}[out]`,
  ].join(";");
  const codec = options.format === "gif" ? ["-loop", "0"]
    : options.format === "webm" ? ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p"]
      : ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  return [
    "-framerate", String(fps), "-i", path.join(work, "v_%05d.png"),
    "-framerate", String(fps), "-i", path.join(work, "d_%05d.png"),
    ...(sound ? ["-i", sound] : []),
    "-filter_complex", graph,
    "-map", "[out]",
    ...(sound ? ["-map", "2:a:0", "-c:a", options.format === "webm" ? "libopus" : "aac", "-b:a", "160k"] : ["-an"]),
    ...codec,
    // Sound can outlast the drawings: the clip ends with the last drawing.
    "-t", (frames / fps).toFixed(3),
    out,
  ];
}

/**
 * Renders (or finds, rendered earlier) the comparison clip of `frames` into `dir`. The file is named by what
 * went into it, so the same choices over the same drawings are one render, and a redrawn frame is a new one.
 */
export async function renderCompare(input: { readonly dir: string; readonly base: string; readonly fps: number; readonly frames: readonly CompareFrame[]; readonly sound: string | null; readonly options: CompareOptions }): Promise<CompareResult> {
  const { dir, fps, frames, options } = input;
  if (!frames.length) throw new AppError("nothing_to_export", 409, "No frame is approved yet.");
  const sound = options.format === "gif" ? null : options.sound ? input.sound : null;
  const [source, drawing] = await Promise.all([sharp(frames[0].source).metadata(), sharp(frames[0].drawing).metadata()]);
  if (!source.width || !source.height || !drawing.width || !drawing.height) throw new AppError("compare_failed", 500, "A frame of this run couldn’t be read.");
  const geometry = compareGeometry(options.layout, { width: source.width, height: source.height }, { width: drawing.width, height: drawing.height }, COMPARE_SIZES[options.size]);

  const stamps = await Promise.all(frames.map(async (frame) => { const info = await stat(frame.drawing); return `${frame.index}:${info.size}:${Math.round(info.mtimeMs)}`; }));
  const key = createHash("sha256").update(JSON.stringify([VERSION, fps, { ...options, sound: sound !== null }, stamps])).digest("hex").slice(0, 16);
  const file = `${key}.${options.format}`;
  const folder = path.join(dir, "compare");
  const out = path.join(folder, file);
  await mkdir(folder, { recursive: true });

  const exists = await stat(out).then((info) => info.size > 0, () => false);
  if (!exists) {
    const pending = rendering.get(out) ?? render({ folder, out, fps, frames, geometry, options, sound }).finally(() => rendering.delete(out));
    rendering.set(out, pending);
    await pending;
    await prune(folder, file);
  }
  return {
    file,
    name: `${input.base}_${options.layout === "side" ? "side-by-side" : "stacked"}.${options.format}`,
    format: options.format,
    bytes: (await stat(out)).size,
    width: geometry.canvas.width,
    height: geometry.canvas.height,
    frames: frames.length,
    fps: compareRate(fps, options.format),
    seconds: Math.round((frames.length / fps) * 100) / 100,
    sound: sound !== null,
  };
}

async function render(input: { readonly folder: string; readonly out: string; readonly fps: number; readonly frames: readonly CompareFrame[]; readonly geometry: CompareGeometry; readonly options: CompareOptions; readonly sound: string | null }): Promise<void> {
  const { folder, out, frames, options } = input;
  // ffmpeg reads the pictures as numbered sequences: links, not copies, because the frames may not be numbered from 1 or in a row.
  const work = path.join(folder, `.work-${randomUUID()}`);
  const partial = path.join(folder, `${path.basename(out).replace(/\.[^.]+$/, "")}.${randomUUID()}.part.${options.format}`);
  await mkdir(work, { recursive: true });
  try {
    await Promise.all(frames.flatMap((frame, position) => {
      const number = String(position + 1).padStart(5, "0");
      return [symlink(path.resolve(frame.source), path.join(work, `v_${number}.png`)), symlink(path.resolve(frame.drawing), path.join(work, `d_${number}.png`))];
    }));
    await ffmpeg(compareArgs({ work, out: partial, fps: input.fps, frames: frames.length, geometry: input.geometry, options, sound: input.sound }), 900_000);
    await rename(partial, out);
  } finally {
    await Promise.all([rm(work, { recursive: true, force: true }), rm(partial, { force: true })]);
  }
}

/** Keeps the newest few clips of a run (a person trying layouts leaves one per try). */
async function prune(folder: string, keep: string): Promise<void> {
  const names = (await readdir(folder)).filter((name) => NAME.test(name));
  const dated = await Promise.all(names.map(async (name) => ({ name, at: (await stat(path.join(folder, name)).catch(() => null))?.mtimeMs ?? 0 })));
  const stale = dated.filter((entry) => entry.name !== keep).sort((a, b) => b.at - a.at).slice(KEEP - 1);
  await Promise.all(stale.map((entry) => rm(path.join(folder, entry.name), { force: true })));
}

/** A clip rendered earlier, by the name a result gave; never a path from the request. */
export function compareFile(dir: string, name: string): { readonly file: string; readonly type: string } {
  const match = NAME.exec(name);
  if (!match) throw new AppError("media_not_found", 404, "This file is no longer available.");
  return { file: path.join(dir, "compare", name), type: TYPE[match[1] as CompareOptions["format"]] };
}
