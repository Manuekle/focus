import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { readMetaConfig } from "../ai/meta";
import { AppError } from "../errors";
import { segmentImage } from "../ai/sam";
import { generateImage, imageRequestBody } from "../animation/muse-image";
import { area, fromAlpha, fromBackdrop, hasTransparency, largestComponent, maskToPng, type Mask } from "../mapping/mask";
import { estimatePose, poseToolAvailable } from "../mapping/pose-estimator";
import { skeletonFromPose } from "../mapping/skeleton";
import { fromRgba, toRgba } from "../rotoscope/alpha";
import { mannequin } from "../rotoscope/mannequin";
import { describePose, type Pose } from "../rotoscope/pose-match";
import { bodyConfidence, evaluate, headContacts, stanceContrast, type Figure } from "./measure";
import { sizeFor, variantRequest, type Variant } from "./prompt";
import { cropSheet, panelRow, poseOverlay, skeletonAlignment } from "./render";
import { reportMarkdown, summarize, type DebugRecord, type ImageInfo } from "./report";

// single_frame_debug: ONE drawing from a pose reference (Image A) and a character
// reference (Image B), with every input, the exact request and a measured
// evaluation written to debug_runs/<timestamp>/. Nothing is fixed or retried:
// the point is to see what Muse Image does with the two images alone.
//
//   pnpm single-frame-debug --pose pose.png --character hero.png
//
// The pose estimator (services/animation-worker) and SAM 3.1 are optional:
// without them the run still draws and reports which checks it couldn't make.

export type SingleFrameDebugOptions = {
  readonly pose: string;
  readonly character: string;
  /** Where the run folder goes; default ./debug_runs. */
  readonly out?: string;
  /** Muse Image aspect hint "WxH"; default from the pose reference's aspect. */
  readonly size?: string;
  readonly reasoning?: "high" | "low";
  /** Evaluate this image instead of calling Muse Image (an earlier output, a frame of a multi-frame run). */
  readonly generated?: string;
  /** What to try against the base prompt (prompt.ts VARIANTS); default "base". */
  readonly variant?: Variant;
  /** Write the inputs and the request only: no paid call, no evaluation. */
  readonly dry?: boolean;
  /** SAM 3.1 figure masks (one Meta call per image); default on when the Meta key is set. */
  readonly sam?: boolean;
  readonly log?: (line: string) => void;
  readonly signal?: AbortSignal;
};

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The returned image's own format, by its magic bytes. */
export const rawExtension = (bytes: Buffer) => (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpg" : bytes.subarray(8, 12).toString() === "WEBP" ? "webp" : "bin");

type Mapped = { readonly mask: Mask; readonly method: string; readonly confidence: number | null };

/**
 * The figure's pixels: the image's own transparency when it has some, else SAM 3.1 (kept when it
 * covers a plausible share of the frame), else everything not connected to the border's backdrop.
 */
async function figureMask(png: Buffer, concept: string, sam: boolean, signal?: AbortSignal): Promise<Mapped> {
  const image = await toRgba(png);
  if (hasTransparency(image)) return { mask: largestComponent(fromAlpha(image)), method: "alpha", confidence: null };
  let note = "";
  if (sam) {
    try {
      const best = (await segmentImage({ png, width: image.width, height: image.height, concept, signal }))[0];
      if (best) {
        const mask: Mask = { width: image.width, height: image.height, data: best.alpha.map((v) => (v ? 1 : 0)) };
        const share = area(mask) / (image.width * image.height);
        if (share > 0.01 && share < 0.95) return { mask, method: `sam-3.1 ("${concept}")`, confidence: best.confidence };
        note = ` (SAM mask covered ${(share * 100).toFixed(0)} % of the image, not used)`;
      } else note = " (SAM found nothing)";
    } catch (error) {
      note = ` (SAM failed: ${error instanceof Error ? error.message.slice(0, 100) : String(error)})`;
    }
  }
  return { mask: fromBackdrop(image), method: `backdrop flood fill${note}`, confidence: null };
}

async function detect(file: string, out: string): Promise<{ pose: Pose; estimator: string; fallback: boolean } | { error: string }> {
  if (!poseToolAvailable()) return { error: "pose tool not installed (services/animation-worker/.venv); see services/animation-worker/README.md" };
  try {
    const found = await estimatePose(file, out);
    return found ?? { error: "no person with a visible torso found" };
  } catch (error) {
    return { error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

/** The request with each data URL replaced by the file it was saved to: readable, and exact to the byte. */
export async function savedRequest(dir: string, body: unknown, names: readonly string[]): Promise<unknown> {
  let n = 0;
  const walk = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (!value || typeof value !== "object") return value;
    const entries = await Promise.all(Object.entries(value).map(async ([key, inner]) => {
      if (key === "image_url" && typeof inner === "string" && inner.startsWith("data:")) {
        const bytes = Buffer.from(inner.slice(inner.indexOf(",") + 1), "base64");
        const file = names[n++] ?? `sent_image_${n}.png`;
        await writeFile(path.join(dir, file), bytes);
        const { width, height } = await sharp(bytes).metadata();
        return [key, { sent_as: "data:image/png;base64 (inline)", file, bytes: bytes.length, sha256: sha256(bytes), width, height }];
      }
      return [key, await walk(inner)];
    }));
    return Object.fromEntries(entries);
  };
  return walk(body);
}

async function readImage(file: string, dir: string, name: string): Promise<{ png: Buffer; info: ImageInfo }> {
  const original = await readFile(file);
  // EXIF orientation applied, sRGB, PNG: the pixels every later step (and Muse) sees.
  const png = await sharp(original).rotate().toColourspace("srgb").png().toBuffer();
  const { width = 0, height = 0 } = await sharp(png).metadata();
  await writeFile(path.join(dir, name), png);
  return { png, info: { source: path.resolve(file), file: name, width, height, sha256: sha256(original) } };
}

export async function singleFrameDebug(options: SingleFrameDebugOptions): Promise<{ dir: string; record: DebugRecord }> {
  const log = options.log ?? (() => {});
  const createdAt = new Date().toISOString();
  const dir = path.join(path.resolve(options.out ?? "debug_runs"), createdAt.replace(/[:.]/g, "-"));
  await mkdir(path.join(dir, "work"), { recursive: true });
  const files: Record<string, string> = {};
  const wrote = async (name: string, data: Buffer | string, what: string) => { await writeFile(path.join(dir, name), data); files[name] = what; };
  log(`single_frame_debug → ${dir}`);

  // 1. Inputs, copied as the PNGs everything else reads.
  const pose = await readImage(options.pose, dir, "pose_reference.png");
  const character = await readImage(options.character, dir, "character_reference.png");
  files["pose_reference.png"] = "Image A as read (EXIF-rotated, sRGB PNG)";
  files["character_reference.png"] = "Image B as read (EXIF-rotated, sRGB PNG)";

  // 2. Pose and masks of both references, before anything is generated.
  const config = readMetaConfig();
  const sam = options.sam ?? Boolean(config);
  const tools: { pose: Record<string, unknown>; segmentation: Record<string, unknown> } = { pose: {}, segmentation: {} };
  const poses: Record<string, Pose | null> = {};
  const masks: Record<string, Mask | null> = {};
  const analyse = async (name: string, file: string, png: Buffer, concept: string, overlay: string, maskFile: string) => {
    const found = await detect(path.join(dir, file), path.join(dir, "work", `${name.replace(/ /g, "_")}_pose.json`));
    poses[name] = "error" in found ? null : found.pose;
    tools.pose[name] = "error" in found ? found : { estimator: found.estimator, fallback: found.fallback, bodyConfidence: bodyConfidence(found.pose) };
    log(`  ${name}: pose ${"error" in found ? `unavailable (${found.error})` : `${found.estimator}, body confidence ${bodyConfidence(found.pose)}`}`);
    if (poses[name]) await wrote(overlay, await poseOverlay(png, poses[name]!), `${name}'s detected keypoints (red = subject's right, blue = left, orange = face)`);
    try {
      const mapped = await figureMask(png, concept, sam, options.signal);
      masks[name] = mapped.mask;
      tools.segmentation[name] = { method: mapped.method, confidence: mapped.confidence };
      await wrote(maskFile, await maskToPng(mapped.mask), `${name}'s figure mask (${mapped.method})`);
      log(`  ${name}: mask ${mapped.method}`);
    } catch (error) {
      masks[name] = null;
      tools.segmentation[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  };
  await analyse("pose reference", pose.info.file, pose.png, "person", "pose_overlay.png", "segmentation_mask.png");
  await analyse("character reference", character.info.file, character.png, "anime character", "character_overlay.png", "character_mask.png");

  // 3. The prompt and the exact request, saved before the call.
  const variant = options.variant ?? "base";
  // An edit keeps Image A's aspect when no size is given: its canvas is A's.
  const size = options.size ?? (variant === "edit" ? undefined : sizeFor(pose.info.width, pose.info.height));
  const reasoning = options.reasoning ?? "high";
  const posed = poses["pose reference"];
  let mannequinPng: Buffer | undefined;
  if (variant === "mannequin" && posed) {
    const shaded = mannequin(skeletonFromPose(posed), { width: pose.info.width, height: pose.info.height }).shaded;
    mannequinPng = await sharp(await fromRgba(shaded)).flatten({ background: "#ffffff" }).png().toBuffer();
    await wrote("mannequin.png", mannequinPng, "Image C: the posing mannequin built from Image A's skeleton");
  }
  const described = posed ? [describePose(posed), ...headContacts(posed)].filter(Boolean).join(" ") : undefined;
  const sheetPose = poses["character reference"];
  const stance = posed && sheetPose ? stanceContrast(posed, sheetPose) : null;
  const { prompt, references, action } = variantRequest(variant, { pose: pose.png, character: character.png, mannequin: mannequinPng, described, stance });
  const model = config?.imageModel ?? "muse-image-1.0";
  await wrote("muse_prompt.txt", prompt, `the prompt text (variant "${variant}"), exactly as sent after the labelled images`);
  const body = await imageRequestBody({ prompt, references, size, reasoning, action }, model);
  const sent = references.map((_, i) => `sent_image_${"abc"[i]}.png`);
  const request = { variant, endpoint: `${config?.baseUrl ?? "(Meta base URL)"}/responses`, body: await savedRequest(dir, body, sent) };
  await wrote("muse_request.json", JSON.stringify(request, null, 2), "the complete Responses API request; images replaced by the files holding their exact bytes");
  references.forEach((reference, i) => { files[sent[i]] = `${reference.label} exactly as sent to Muse (resized to ≤ 1024 px long side)`; });

  // 4. One drawing (or the given image).
  let generation: DebugRecord["generation"];
  let output: Buffer | null = null;
  if (options.generated) {
    output = await sharp(await readFile(options.generated)).rotate().toColourspace("srgb").png().toBuffer();
    const { width = 0, height = 0 } = await sharp(output).metadata();
    generation = { source: "file", file: path.resolve(options.generated), width, height };
  } else if (options.dry) {
    generation = { source: "skipped", reason: "dry run (--dry): inputs and request only" };
  } else {
    log(`  Muse Image: ${model}, variant ${variant}, ${size ?? "Image A's aspect"}, reasoning ${reasoning} …`);
    const started = Date.now();
    try {
      // One request, never retried: a debug run makes at most one generation.
      const image = await generateImage({ prompt, references, size, reasoning, action, signal: options.signal, attempts: 1 });
      output = image.png;
      if (image.raw) await wrote(`generated_raw.${rawExtension(image.raw)}`, image.raw, "Muse Image's output bytes exactly as returned (base64-decoded, not converted)");
      if (image.response) await wrote("muse_response.json", JSON.stringify(image.response, null, 2), "the provider's response metadata (id, status, model, usage, requests, latency); the image itself is generated_raw.*");
      generation = { source: "muse", durationMs: Date.now() - started, width: image.width, height: image.height, requests: image.response?.requests ?? 1, usage: image.response?.usage ?? null, responseId: image.response?.id ?? null };
      log(`  drawn ${image.width}×${image.height} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (error) {
      generation = { source: "failed", kind: "api", code: error instanceof AppError ? error.code : null, error: error instanceof Error ? error.message : String(error) };
      log(`  Muse Image failed: ${generation.error}`);
    }
  }

  // 5. The output measured against both references.
  let checks: DebugRecord["checks"] = [];
  if (output) {
    await wrote("generated.png", output, generation.source === "file" ? "the given output (not generated in this run)" : "Muse Image's drawing");
    await analyse("output", "generated.png", output, "anime character", "generated_overlay.png", "generated_mask.png");
    const figure = async (png: Buffer, name: string): Promise<Figure> => ({ pose: poses[name], image: await toRgba(png), mask: masks[name] });
    checks = evaluate({ pose: await figure(pose.png, "pose reference"), character: await figure(character.png, "character reference"), output: await figure(output, "output") });
    const aligned = poses["pose reference"] && poses.output ? await skeletonAlignment(output, poses["pose reference"], poses.output) : null;
    if (aligned) await wrote("skeleton_alignment.png", aligned, "Image A's skeleton fitted on the output's torso (dashed green) over the output's skeleton (pink)");
    await wrote("comparison.png", await panelRow([
      { label: "A · pose reference", png: pose.png },
      { label: "B · character reference", png: character.png },
      { label: "Output", png: output },
      { label: "A's pose (green) vs output (pink)", png: aligned, note: "no pose on A or output" },
    ]), "A, B, the output and the skeleton comparison side by side");
    await wrote("crops.png", await cropSheet([
      { label: "A", png: pose.png, pose: poses["pose reference"] },
      { label: "B", png: character.png, pose: poses["character reference"] },
      { label: "output", png: output, pose: poses.output },
    ]), "head, each hand and the feet cropped from A, B and the output");
  }

  const record: DebugRecord = {
    mode: "single_frame_debug",
    createdAt,
    dir,
    inputs: { pose: pose.info, character: character.info },
    request: { variant, model, size: size ?? "Image A's aspect", reasoning },
    generation,
    tools: tools as DebugRecord["tools"],
    checks,
    summary: summarize(checks),
    files: { ...files, "evaluation.json": "this record", "comparison_report.md": "the report" },
  };
  await writeFile(path.join(dir, "evaluation.json"), JSON.stringify(record, null, 2));
  await writeFile(path.join(dir, "comparison_report.md"), reportMarkdown(record, prompt));
  if (generation.source === "failed") throw new Error(`Muse Image failed: ${generation.error} (inputs and request kept in ${dir})`);
  return { dir, record };
}
