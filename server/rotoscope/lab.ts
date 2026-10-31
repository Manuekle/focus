import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { generateImage, type ImageReference } from "../animation/muse-image";
import { mapFrame, openMapping } from "../mapping/engine";
import { fromAlpha } from "../mapping/mask";
import { palette, paletteSimilarity } from "../mapping/profile";
import { estimatePose } from "../mapping/pose-estimator";
import { jointErrors } from "../mapping/retarget";
import { skeletonFromPose, type Skeleton } from "../mapping/skeleton";
import { fromRgba, KEY_COLOR, keyOut, toRgba } from "./alpha";
import { onCanvas } from "./body-map";
import { CANVAS, describeMotion, fitCanvas, framePrompt, swapFramePrompt, toCanvas, type FrameInput } from "./draw";
import { frameName } from "./extract";
import { toLine, withGrid } from "./grid";
import { mannequin, MANNEQUIN_ROLE } from "./mannequin";
import { comparePoses, describeLegs, describePose, type Pose } from "./pose-match";
import { layoutRun } from "./pipeline";
import { readManifest } from "./run-state";
import { outlineDensity } from "./style";

// Pose laboratory (console only): Muse Image draws one image per setting, no
// firewall and no retries, and each result is measured the way the firewall
// measures a drawing (DWPose against the video frame), plus joint error
// against the target skeleton and how close colours and line work stay to
// the character. What changes between settings is what Muse Image is shown
// and told: the production references (skeleton guide, greyscale video
// frame), or a posing mannequin of the target skeleton (mannequin.ts) —
// coloured volumes per body part, shaded by depth so the nearer limb is
// lighter and overlaps read — with or without its depth map, as separate
// images or one single composite next to the character. Muse Image has no
// temperature or seed; its only sampling setting is reasoning_strength, and
// repeats of one setting measure how much its results spread.

export type LabSetting = {
  readonly name: string;
  readonly references: "guide" | "mannequin" | "mannequin+depth" | "mannequin+video" | "single" | "swap";
  readonly reasoning: "high" | "low";
  /** Every joint's grid coordinates and every limb's length in the prompt (body-map.ts). */
  readonly coordinates: boolean;
  /** "swap" only: Muse Spark's short pose note of this frame, and the character's identity line, in the prompt. */
  readonly note?: boolean;
  readonly identity?: boolean;
};

export const PILOT: readonly LabSetting[] = [
  { name: "guide", references: "guide", reasoning: "high", coordinates: true },
  { name: "mannequin", references: "mannequin", reasoning: "high", coordinates: false },
  { name: "mannequin-low", references: "mannequin", reasoning: "low", coordinates: false },
  { name: "mannequin-coords", references: "mannequin", reasoning: "high", coordinates: true },
  { name: "mannequin-depth", references: "mannequin+depth", reasoning: "high", coordinates: false },
  { name: "mannequin-video", references: "mannequin+video", reasoning: "high", coordinates: false },
  { name: "single", references: "single", reasoning: "high", coordinates: false },
  { name: "single-low", references: "single", reasoning: "low", coordinates: false },
];

/**
 * Short prompts, the way /characters edits a design: the video frame itself is Image 1 and Muse Image
 * edits the person into the character, so the pose comes from the picture and not from a skeleton
 * read through a long specification. Each adds one thing to the one before.
 */
export const SWAP: readonly LabSetting[] = [
  { name: "swap", references: "swap", reasoning: "high", coordinates: false },
  { name: "swap-note", references: "swap", reasoning: "high", coordinates: false, note: true },
  { name: "swap-id", references: "swap", reasoning: "high", coordinates: false, note: true, identity: true },
];

// ── Prompt ─────────────────────────────────────────────────────────────────

export function labPrompt(input: { description: string; source: Pose; reading: string; marks: FrameInput["marks"]; bodyMap: string; single: boolean }): string {
  const pose = input.single ? "the posing mannequin on the right half of Image 1" : "the posing mannequin of Image 2";
  const character = input.single ? "the character on the left half of Image 1" : "the character of Image 1";
  return [
    `Draw ONE frame of a hand-drawn 2D anime animation: ${character}, alone, holding exactly the pose of ${pose}.`,
    "Put every joint where the mannequin has it: shoulders, elbows, wrists, hands, hips, knees, ankles and feet on the same grid cells, every limb at the same angle, with the same overlaps (which arm or hand is in front) and the same foreshortening. The mannequin is a pose model only: draw the character's own body, clothes and hair over that pose, never the coloured volumes.",
    `Pose in words, sides as seen in the picture (never mirrored): ${describePose(input.source)} ${describeLegs(input.source)}`,
    ...(input.reading ? [`The pose, described by a person watching the video (trust it for head, eyes, mouth and hands): ${input.reading}`] : []),
    ...(input.bodyMap ? [input.bodyMap] : []),
    `Character design (must not change): ${input.description}`,
    `Size and placement (grid lines counted from the top, 0 to 12): the top of the hair on line ${toLine(input.marks.head)}, the soles on line ${toLine(input.marks.feet)}, the hips centred on the vertical green line. Full body, nothing touching the edges.`,
    "Style: identical to the character sheet: clean thin dark lineart, flat cel colours, minimal soft shading. One character only.",
    `Background: perfectly flat solid ${KEY_COLOR} magenta everywhere. The grid, numbers, lines and mannequin colours are measuring aids: do not draw them. No floor, no shadow, no text. Never use magenta or pink on the character.`,
  ].join("\n");
}

// ── The laboratory ─────────────────────────────────────────────────────────

export type LabResult = {
  readonly frame: number;
  readonly setting: string;
  readonly repeat: number;
  readonly seconds: number;
  /** The firewall's pose check against the video frame. */
  readonly pose: { readonly passed: boolean; readonly mean: number | null; readonly worst: number | null; readonly detail: string };
  /** Mean joint distance to the target skeleton, torso lengths. */
  readonly jointError: number | null;
  /** Colour palette overlap with the character sheet (0–1). */
  readonly palette: number | null;
  /** Line work against the run's first approved drawing (1 = same density). */
  readonly outlines: number | null;
  readonly file: string;
};

const onWhite = (png: Buffer) => sharp(png).flatten({ background: "#ffffff" }).png().toBuffer();

export async function runLab(dir: string, options: { readonly frames: readonly number[]; readonly settings: readonly LabSetting[]; readonly repeats?: number; readonly log: (line: string) => void }): Promise<string> {
  const { log } = options;
  const manifest = await readManifest(dir);
  const { guides, fit, poseImages, character } = await layoutRun(dir);
  const sourcePoses = (JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as { frames: Pose[] }).frames;
  const description = (await readFile(path.join(dir, "character.txt"), "utf8")).trim();
  const engine = await openMapping(dir, { manifest, log });
  const out = path.join(dir, "lab", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(out, { recursive: true });
  const firstApproved = manifest.frames.find((frame) => frame.approved);
  const anchorDensity = firstApproved ? outlineDensity(await toRgba(await readFile(path.join(dir, firstApproved.approved!.file)))) : null;
  const sheetPalette = engine.sheet.profile.palette;
  const results: LabResult[] = [];
  const save = () => writeFile(path.join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  for (const index of options.frames) {
    const name = frameName(index).replace(".png", "");
    const folder = path.join(out, name);
    await mkdir(folder, { recursive: true });
    const { guide, sourceGrey, marks, spec } = await poseImages(index);
    // The target skeleton on the canvas: the mapping's retarget, as for a new frame (nothing approved to deform).
    const mapped = await mapFrame(engine, { index, manifest, guide: onCanvas(guides.frames[index - 1], fit), marks, canvas: CANVAS, exclude: new Set(manifest.frames.map((frame) => `frame ${frame.index}`)) });
    const target = mapped.target.skeleton;
    const body = mannequin(target, CANVAS);
    const shaded = await withGrid(await fromRgba(body.shaded), marks);
    const depth = await withGrid(await fromRgba(body.depth), marks);
    const single = await sharp({ create: { width: CANVAS.width * 2, height: CANVAS.height, channels: 3, background: "#ffffff" } })
      .composite([{ input: await sharp(await onWhite(character)).resize(CANVAS.width, CANVAS.height, { fit: "contain", background: "#ffffff" }).png().toBuffer(), left: 0, top: 0 }, { input: shaded, left: CANVAS.width, top: 0 }])
      .png().toBuffer();
    // References as ref-*.png: a setting's drawing is saved under the setting's own name.
    await writeFile(path.join(folder, "ref-mannequin.png"), shaded);
    await writeFile(path.join(folder, "ref-depth.png"), depth);
    await writeFile(path.join(folder, "ref-single.png"), single);
    const reading = await readFile(path.join(dir, `readings/${name}.txt`), "utf8").then((text) => text.trim(), () => "");
    const source = sourcePoses[index - 1];
    const videoFrame = await readFile(path.join(dir, manifest.frames[index - 1].source));
    for (const setting of options.settings) {
      let prompt: string;
      let references: ImageReference[];
      if (setting.references === "swap") {
        // The colour video frame letterboxed onto the canvas (never stretched), then the character.
        const corner = await sharp(videoFrame).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
        const frame = await fitCanvas(videoFrame, `rgb(${corner[0]},${corner[1]},${corner[2]})`);
        const note = setting.note ? await describeMotion({ frame: videoFrame }) : "";
        ({ prompt, references } = swapFramePrompt({ frame, character, description: setting.identity ? description : "", note, correction: null, feedback: [] }));
      } else if (setting.references === "guide") {
        // Exactly what production sends today: sheet, skeleton guide, greyscale video frame.
        ({ prompt, references } = framePrompt({ character, description, guide, sourceGrey, previous: null, anchor: null, marks, poseText: describePose(source), bodyMap: spec?.text ?? "", face: "", reading, correction: null, feedback: [] }));
      } else {
        const isSingle = setting.references === "single";
        prompt = labPrompt({ description, source, reading, marks, bodyMap: setting.coordinates ? spec?.text ?? "" : "", single: isSingle });
        references = isSingle
          ? [{ png: single, role: `LEFT HALF: THE CHARACTER (design to copy: face, hair, clothes, colours, line style). RIGHT HALF: ${MANNEQUIN_ROLE}` }]
          : [
            { png: character, role: "THE CHARACTER. Copy this exact design: face, hair, every clothing item, colours, line style, head size and build. Its pose is NOT the pose to draw." },
            { png: shaded, role: MANNEQUIN_ROLE },
            ...(setting.references === "mannequin+depth" ? [{ png: depth, role: "THE MANNEQUIN'S DEPTH MAP: white is nearest the viewer, black is background. Use it for which limb is in front." }] : []),
            ...(setting.references === "mannequin+video" ? [{ png: sourceGrey, role: "POSE PHOTO of a different person (greyscale), same grid: copy only hand shapes, head tilt and expression; never this person's look." }] : []),
          ];
      }
      await writeFile(path.join(folder, `${setting.name}.prompt.txt`), `${references.map((reference, i) => `Image ${i + 1}: ${reference.role}`).join("\n")}\n\n${prompt}\n`);
      for (let repeat = 1; repeat <= (options.repeats ?? 1); repeat++) {
        const label = options.repeats && options.repeats > 1 ? `${setting.name}-r${repeat}` : setting.name;
        log(`frame ${index} · ${label}: Muse Image (${setting.reasoning})…`);
        const started = Date.now();
        const image = await generateImage({ prompt, references, size: `${CANVAS.width}x${CANVAS.height}`, reasoning: setting.reasoning, ...(setting.references === "swap" ? { action: "edit" as const } : {}) });
        const seconds = Math.round((Date.now() - started) / 1000);
        const keyed = keyOut(await toRgba(await toCanvas(image.png)));
        const file = path.join(folder, `${label}.png`);
        await writeFile(file, await fromRgba(keyed));
        const measured = await estimatePose(file, file.replace(".png", "_pose.json"));
        const check = measured ? comparePoses(source, measured.pose) : null;
        const errors = measured ? Object.values(jointErrors(target, skeletonFromPose(measured.pose))) : [];
        const result: LabResult = {
          frame: index, setting: setting.name, repeat, seconds,
          pose: check ? { passed: check.passed, mean: check.score ?? null, worst: Math.max(0, ...check.bones.map((bone) => bone.degrees)), detail: check.detail } : { passed: false, mean: null, worst: null, detail: "no body found" },
          jointError: errors.length ? Math.round((errors.reduce((sum, v) => sum + v, 0) / errors.length) * 1000) / 1000 : null,
          palette: paletteSimilarity(palette(keyed, fromAlpha(keyed)), sheetPalette),
          outlines: anchorDensity ? Math.round((outlineDensity(keyed) / anchorDensity) * 100) / 100 : null,
          file: path.relative(dir, file),
        };
        results.push(result);
        await save();
        log(`  ${result.pose.passed ? "ok  " : "FAIL"} pose ${result.pose.detail}; joints ${result.jointError ?? "—"}; palette ${result.palette}; outlines ×${result.outlines ?? "—"}; ${seconds} s`);
      }
    }
    // One sheet per frame: video | mannequin | every drawing.
    const cells = [path.join(dir, manifest.frames[index - 1].source), path.join(folder, "ref-mannequin.png"),
      ...results.filter((r) => r.frame === index).map((r) => path.join(dir, r.file))].filter(existsSync);
    const tiles = await Promise.all(cells.map((file) => sharp(file).flatten({ background: "#ffffff" }).resize(256, 384, { fit: "contain", background: "#ffffff" }).png().toBuffer()));
    const columns = Math.min(6, tiles.length);
    await sharp({ create: { width: columns * 260, height: Math.ceil(tiles.length / columns) * 388, channels: 3, background: "#dddddd" } })
      .composite(tiles.map((input, i) => ({ input, left: (i % columns) * 260, top: Math.floor(i / columns) * 388 })))
      .png().toFile(path.join(folder, "sheet.png"));
  }
  const lines = ["| frame | setting | # | pose | mean ° | worst ° | joints | palette | outlines | s |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.frame} | ${r.setting} | ${r.repeat} | ${r.pose.passed ? "pass" : "fail"} | ${r.pose.mean ?? "—"} | ${r.pose.worst ?? "—"} | ${r.jointError ?? "—"} | ${r.palette ?? "—"} | ${r.outlines ?? "—"} | ${r.seconds} |`);
  await writeFile(path.join(out, "results.md"), `${lines.join("\n")}\n`);
  return out;
}

// ── Overlay scan of saved drawings (no model call) ─────────────────────────

/**
 * Scans drawings already on disk with the overlay scan (scan.ts): a lab's results, and the run's
 * approved frames and rejected attempts for `frames`, so the scan's limits can be set from
 * drawings a person or the review accepted against ones the firewall rejected. Writes
 * scan-*.png overlays next to each drawing and scan.md.
 */
export async function scanSaved(dir: string, options: { readonly lab?: string; readonly frames: readonly number[]; readonly log: (line: string) => void }): Promise<string> {
  const { scanOverlay, scanPose } = await import("./scan");
  const manifest = await readManifest(dir);
  const { guides, fit, poseImages } = await layoutRun(dir);
  const engine = await openMapping(dir, { manifest, log: options.log });
  const exclude = new Set(manifest.frames.map((frame) => `frame ${frame.index}`));
  const targets = new Map<number, { skeleton: Skeleton; video: Buffer }>();
  const targetFor = async (index: number) => {
    let found = targets.get(index);
    if (!found) {
      const { marks, sourceGrey } = await poseImages(index);
      const mapped = await mapFrame(engine, { index, manifest, guide: onCanvas(guides.frames[index - 1], fit), marks, canvas: CANVAS, exclude });
      found = { skeleton: mapped.target.skeleton, video: sourceGrey };
      targets.set(index, found);
    }
    return found;
  };
  const rows: string[] = ["| kind | frame | drawing | scan | mean | bad cells | detail |", "| --- | --- | --- | --- | --- | --- | --- |"];
  const scanFile = async (kind: string, index: number, file: string, poseFile: string | null) => {
    const png = await readFile(file);
    const cached = poseFile && existsSync(poseFile) ? poseFile : existsSync(file.replace(".png", "_scanpose.json")) ? file.replace(".png", "_scanpose.json") : null;
    const pose = cached ? (JSON.parse(await readFile(cached, "utf8")) as { frames: Pose[] }).frames[0] : (await estimatePose(file, file.replace(".png", "_scanpose.json")))?.pose;
    const { skeleton, video } = await targetFor(index);
    const drawn = pose ? skeletonFromPose(pose) : null;
    const report = scanPose(skeleton, drawn, await toRgba(png));
    await writeFile(file.replace(/\.png$/, "_scan.png"), await scanOverlay(video, png, skeleton, drawn, report));
    rows.push(`| ${kind} | ${index} | ${path.basename(file)} | ${report.passed ? "pass" : "fail"} | ${report.mean?.toFixed(3) ?? "—"} | ${report.cells.length} | ${report.detail} |`);
    options.log(`${kind} ${index} ${path.basename(file)}: ${report.passed ? "ok  " : "FAIL"} ${report.detail}`);
    return report;
  };
  if (options.lab) {
    const labDir = path.join(dir, "lab", options.lab);
    const results = JSON.parse(await readFile(path.join(labDir, "results.json"), "utf8")) as LabResult[];
    for (const result of results) {
      const file = path.join(dir, result.file);
      await scanFile(`lab:${result.setting}`, result.frame, file, file.replace(".png", "_pose.json"));
    }
  }
  for (const index of options.frames) {
    const frame = manifest.frames.find((entry) => entry.index === index);
    if (!frame) continue;
    for (const attempt of frame.attempts) {
      const file = path.join(dir, attempt.file);
      if (!existsSync(file) || attempt.attempt !== frame.approved?.attempt && attempt.passed) continue;
      await scanFile(frame.approved?.attempt === attempt.attempt ? "approved" : "rejected", index, file, null);
    }
  }
  const out = path.join(dir, "lab", options.lab ?? "", "scan.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${rows.join("\n")}\n`);
  return out;
}
