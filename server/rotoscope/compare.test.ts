import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompareOptionsSchema, type CompareOptions } from "../../shared/rotoscope";
import { ffmpeg, probe } from "../ffmpeg";
import { compareArgs, compareFile, compareGeometry, compareRate, renderCompare, type CompareFrame } from "./compare";

const options = (change: Partial<CompareOptions> = {}): CompareOptions => ({ ...CompareOptionsSchema.parse({}), ...change });
const video = { width: 90, height: 160 };
const art = { width: 40, height: 60 };
const hasFfmpeg = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"]).status === 0;

describe("compareGeometry", () => {
  it("puts both at one height side by side, the longest side being the size", () => {
    const { video: v, drawing: d, canvas } = compareGeometry("side", video, art, 640);
    expect(v.height).toBe(d.height);
    expect(canvas).toEqual({ width: v.width + d.width, height: v.height });
    expect(Math.max(canvas.width, canvas.height)).toBeGreaterThanOrEqual(636);
    expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(640);
  });

  it("puts both at one width when stacked", () => {
    const { video: v, drawing: d, canvas } = compareGeometry("stack", video, art, 1080);
    expect(v.width).toBe(d.width);
    expect(canvas).toEqual({ width: v.width, height: v.height + d.height });
    expect(canvas.height).toBeGreaterThan(canvas.width);
    expect(canvas.height).toBeLessThanOrEqual(1080);
  });

  it("keeps every side even, as H.264 needs, for odd proportions", () => {
    for (const layout of ["side", "stack"] as const) {
      const { video: v, drawing: d, canvas } = compareGeometry(layout, { width: 853, height: 479 }, { width: 1024, height: 1536 }, 1080);
      for (const value of [v.width, v.height, d.width, d.height, canvas.width, canvas.height]) expect(value % 2).toBe(0);
    }
  });

  it("scales a landscape video and a portrait drawing to the same height", () => {
    const { video: v, drawing: d } = compareGeometry("side", { width: 1920, height: 1080 }, { width: 1024, height: 1536 }, 1920);
    expect(v.height).toBe(d.height);
    expect(v.width).toBeGreaterThan(d.width);
  });
});

describe("compareRate", () => {
  it("holds every drawing for a whole number of frames", () => {
    expect(compareRate(9, "mp4")).toBe(27);
    expect(compareRate(12, "webm")).toBe(24);
    expect(compareRate(6, "mov")).toBe(24);
    expect(compareRate(24, "mp4")).toBe(24);
  });
  it("leaves a GIF at the run's rate", () => {
    expect(compareRate(9, "gif")).toBe(9);
  });
});

describe("compareArgs", () => {
  const geometry = compareGeometry("side", video, art, 640);
  const args = (change: Partial<CompareOptions> = {}, sound: string | null = null) => compareArgs({ work: "/w", out: "/o.mp4", fps: 9, frames: 4, geometry, options: options(change), sound });
  const graph = (list: readonly string[]) => list[list.indexOf("-filter_complex") + 1];

  it("stacks left to right, or top to bottom, in the chosen order", () => {
    expect(graph(args())).toContain("[v][d]hstack");
    expect(graph(args({ first: "drawing" }))).toContain("[d][v]hstack");
    expect(graph(args({ layout: "stack", first: "drawing" }))).toContain("[d][v]vstack");
  });

  it("lays the drawings on the chosen background", () => {
    expect(graph(args({ background: "white" }))).toContain("c=0xffffff");
    expect(graph(args({ background: "dark" }))).toContain("c=0x111214");
  });

  it("maps the sound only when there is a track, in the container's codec", () => {
    expect(args()).toContain("-an");
    expect(args({}, "/s.m4a")).toEqual(expect.arrayContaining(["-map", "2:a:0", "aac"]));
    expect(args({ format: "webm" }, "/s.m4a")).toContain("libopus");
  });

  it("builds a palette for a GIF, which has no sound", () => {
    const gif = args({ format: "gif" });
    expect(graph(gif)).toContain("palettegen");
    expect(gif).toContain("-an");
  });
});

describe("compareFile", () => {
  it("serves only names a render made, never a path", () => {
    expect(compareFile("/run", "0123456789abcdef.mp4")).toEqual({ file: path.join("/run", "compare", "0123456789abcdef.mp4"), type: "video/mp4" });
    expect(compareFile("/run", "0123456789abcdef.gif").type).toBe("image/gif");
    for (const bad of ["", "../run.json", "0123456789abcdef.png", "0123456789abcdef.mp4/../x", "ABCDEF0123456789.mp4"]) expect(() => compareFile("/run", bad)).toThrow();
  });
});

describe.skipIf(!hasFfmpeg)("renderCompare", () => {
  let root: string;
  let frames: CompareFrame[];
  let sound: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "roto-compare-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    frames = [];
    for (let index = 1; index <= 4; index += 1) {
      const source = path.join(root, "src", `video_${index}.png`);
      const drawing = path.join(root, "src", `drawing_${index}.png`);
      await sharp({ create: { width: video.width, height: video.height, channels: 3, background: { r: 40 * index, g: 80, b: 120 } } }).png().toFile(source);
      await sharp({ create: { width: art.width, height: art.height, channels: 4, background: { r: 220, g: 30, b: 30, alpha: index % 2 ? 1 : 0.4 } } }).png().toFile(drawing);
      frames.push({ index, source, drawing });
    }
    sound = path.join(root, "sound.m4a");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", sound]);
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  const render = (change: Partial<CompareOptions> = {}, withSound = false) => renderCompare({ dir: root, base: "dance", fps: 9, frames, sound: withSound ? sound : null, options: options({ size: "small", ...change }) });
  const facts = async (result: { file: string }) => {
    const info = await probe(path.join(root, "compare", result.file));
    return { video: info.streams.find((stream) => stream.codec_type === "video"), audio: info.streams.find((stream) => stream.codec_type === "audio"), seconds: Number(info.format.duration) };
  };

  it("renders an MP4 of the size and length it reports, the drawings held evenly", async () => {
    const result = await render();
    const { video: stream, audio } = await facts(result);
    expect(result).toMatchObject({ format: "mp4", frames: 4, fps: 27, sound: false, name: "dance_side-by-side.mp4" });
    expect(stream).toMatchObject({ codec_name: "h264", width: result.width, height: result.height, pix_fmt: "yuv420p" });
    expect(Number(stream?.nb_frames)).toBe(12);
    expect(audio).toBeUndefined();
  });

  it("stacks and carries the sound, ending with the last drawing", async () => {
    const result = await render({ layout: "stack", first: "drawing", sound: true }, true);
    const { video: stream, audio, seconds } = await facts(result);
    expect(result).toMatchObject({ sound: true, name: "dance_stacked.mp4" });
    expect(stream?.height).toBeGreaterThan(stream?.width ?? 0);
    expect(audio?.codec_name).toBe("aac");
    expect(seconds).toBeCloseTo(4 / 9, 1);
  });

  it("renders WebM, MOV and a silent GIF", async () => {
    const [webm, mov, gif] = await Promise.all([render({ format: "webm" }), render({ format: "mov" }), render({ format: "gif", sound: true }, true)]);
    expect((await facts(webm)).video?.codec_name).toBe("vp9");
    expect((await facts(mov)).video?.codec_name).toBe("h264");
    const animated = await facts(gif);
    expect(animated.video?.codec_name).toBe("gif");
    expect(animated.audio).toBeUndefined();
    expect(gif.sound).toBe(false);
  });

  it("finds an earlier render of the same choices instead of encoding again, and a changed drawing is a new one", async () => {
    const first = await render({ background: "dark" });
    const at = (await stat(path.join(root, "compare", first.file))).mtimeMs;
    const again = await render({ background: "dark" });
    expect(again.file).toBe(first.file);
    expect((await stat(path.join(root, "compare", again.file))).mtimeMs).toBe(at);
    expect((await render({ background: "white" })).file).not.toBe(first.file);
    const later = new Date(Date.now() + 60_000);
    await utimes(frames[0].drawing, later, later);
    expect((await render({ background: "dark" })).file).not.toBe(first.file);
  });

  it("answers two clicks at once with one render", async () => {
    const [a, b] = await Promise.all([render({ size: "medium", background: "dark" }), render({ size: "medium", background: "dark" })]);
    expect(a.file).toBe(b.file);
    expect((await readdir(path.join(root, "compare"))).filter((name) => name.startsWith(".work-") || name.includes(".part."))).toEqual([]);
  });

  it("keeps only the newest clips", async () => {
    for (let size = 0; size < 10; size += 1) await render({ format: "gif", background: size % 2 ? "dark" : "white", layout: size % 3 ? "side" : "stack", first: size % 5 ? "video" : "drawing" });
    const clips = (await readdir(path.join(root, "compare"))).filter((name) => /^[0-9a-f]{16}\./.test(name));
    expect(clips.length).toBeLessThanOrEqual(8);
  });

  it("refuses a run with nothing approved", async () => {
    await expect(renderCompare({ dir: root, base: "dance", fps: 9, frames: [], sound: null, options: options() })).rejects.toMatchObject({ code: "nothing_to_export" });
  });
});
