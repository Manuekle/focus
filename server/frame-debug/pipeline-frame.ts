import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readMetaConfig } from "../ai/meta";
import { generateImage, imageRequestBody, type ImageResponse } from "../animation/muse-image";
import { AppError } from "../errors";
import { skeletonFromPose } from "../mapping/skeleton";
import { fromRgba } from "../rotoscope/alpha";
import { onCanvas, describeFace } from "../rotoscope/body-map";
import { CANVAS, framePrompt, onColour, reviewCheck, reviewFrame, sideBySide, structuredFramePrompt, toCanvas, type FrameInput } from "../rotoscope/draw";
import { decide, type Verdict } from "../rotoscope/decision";
import { frameName } from "../rotoscope/extract";
import { withGrid } from "../rotoscope/grid";
import { mannequin } from "../rotoscope/mannequin";
import { keptReading, layoutRun, measureDrawing, PALETTE_FILE } from "../rotoscope/pipeline";
import { armLengths, describeLegs, describePose, measureArms, type Pose } from "../rotoscope/pose-match";
import { assertIsolation, recordReferences, sha256, withSentBytes, type GenerationTarget } from "../rotoscope/provenance";
import { readManifest, type Check } from "../rotoscope/run-state";
import { PALETTE_VERSION, paletteImage, paletteText, profiledPalette, sheetColours, type Palette } from "../rotoscope/colour";
import { namePalette } from "../rotoscope/draw";
import { rawExtension, savedRequest } from "./run";

// single_frame_debug on a rotoscope run: ONE Muse Image drawing of one frame with the pipeline's own
// references and prompt (strategy "existing") or a short structured prompt over the same references
// ("structured"), the exact request, the raw output and the provider's response kept, and the
// drawing measured with the pipeline's checks. Nothing is retried, healed or approved: the run's
// manifest is never touched. The previous frame, style anchor, lessons and feedback are left out —
// this is the frame drawn cold, which is what both strategies are compared on.
//
//   pnpm single-frame-debug --run .focus-data/rotoscope/<id> --frame 1 --strategy existing|structured [--dry]

export type PromptStrategy = "existing" | "structured";

export type PipelineFrameRecord = {
  readonly mode: "single_frame_debug/pipeline";
  readonly createdAt: string;
  readonly run: string;
  readonly frame: number;
  readonly strategy: PromptStrategy;
  readonly target: GenerationTarget;
  readonly reading: "kept" | "none";
  readonly generation:
    | { readonly source: "muse"; readonly durationMs: number; readonly response: ImageResponse | null; readonly raw: string }
    | { readonly source: "file"; readonly file: string }
    | { readonly source: "skipped"; readonly reason: string }
    | { readonly source: "failed"; readonly kind: "api"; readonly code: string | null; readonly error: string };
  readonly checks: readonly Check[];
  /** The decision engine's verdict on the checks (decision.ts); null without a drawing. */
  readonly verdict: Verdict | null;
};

/**
 * The palette generateRun would use: the run's own when it is of the current version, else measured
 * again on the sheet and named by Muse Spark (one text call), as generateRun does. Kept beside the
 * debug runs by character hash, never written into the run: Muse Spark names the same colours
 * differently each time, and two strategies compared must get the same palette image.
 */
async function currentPalette(run: string, character: Buffer, out: string, log: (line: string) => void): Promise<Palette> {
  const kept = existsSync(path.join(run, PALETTE_FILE)) ? JSON.parse(await readFile(path.join(run, PALETTE_FILE), "utf8")) as Palette : null;
  if (kept?.version === PALETTE_VERSION) return kept;
  const cache = path.join(out, `palette-v${PALETTE_VERSION}-${sha256(character).slice(0, 16)}.json`);
  if (existsSync(cache)) return JSON.parse(await readFile(cache, "utf8")) as Palette;
  const colours = await sheetColours(character);
  const names = await namePalette(character, colours).catch(() => colours.map((colour) => `colour ${colour.hex}`));
  const palette = await profiledPalette(character, { version: PALETTE_VERSION, colours: colours.map((colour, i) => ({ ...colour, name: names[i] })) });
  await mkdir(out, { recursive: true });
  await writeFile(cache, `${JSON.stringify(palette, null, 2)}\n`);
  log(`  palette measured again (run's is version ${kept?.version ?? "none"}) and kept in ${cache}: ${paletteText(palette)}`);
  return palette;
}

export async function pipelineFrameDebug(options: {
  readonly run: string;
  readonly frame: number;
  readonly strategy: PromptStrategy;
  readonly out?: string;
  readonly dry?: boolean;
  /** Evaluate this image instead of calling Muse Image (an earlier output of this frame). */
  readonly generated?: string;
  /** Muse Spark's visual review of the drawing (one call); default on when the Meta key is set. */
  readonly review?: boolean;
  readonly log?: (line: string) => void;
  readonly signal?: AbortSignal;
}): Promise<{ dir: string; record: PipelineFrameRecord }> {
  const log = options.log ?? (() => {});
  const run = path.resolve(options.run);
  const index = options.frame;
  const manifest = await readManifest(run);
  const frame = manifest.frames.find((entry) => entry.index === index);
  if (!frame) throw new Error(`frame ${index} doesn't exist in ${run}`);
  const createdAt = new Date().toISOString();
  const dir = path.join(path.resolve(options.out ?? "debug_runs"), "pipeline", `${createdAt.replace(/[:.]/g, "-")}_f${index}_${options.strategy}`);
  await mkdir(path.join(dir, "work"), { recursive: true });
  log(`single_frame_debug (pipeline, ${options.strategy}) → ${dir}`);

  // The frame's inputs, built from the run's files the way generateRun builds them. No model call:
  // a frame reading Muse Spark made earlier is used when kept, never asked for here.
  const { character, poseImages, guides, fit } = await layoutRun(run);
  const { guide, sourceGrey, marks, spec } = await poseImages(index);
  const sources = JSON.parse(await readFile(path.join(run, "source-poses.json"), "utf8")) as { frames: Pose[] };
  const source = sources.frames[index - 1];
  const reading = (await keptReading(run, index)) ?? "";
  const palette = await currentPalette(run, character, path.join(path.resolve(options.out ?? "debug_runs"), "pipeline"), log);
  const input: FrameInput = {
    character,
    description: (await readFile(path.join(run, "character.txt"), "utf8")).trim(),
    guide,
    sourceGrey,
    previous: null,
    marks,
    poseText: describePose(source),
    measured: measureArms(source, armLengths(sources.frames)),
    palette: { image: await paletteImage(palette), text: paletteText(palette) },
    bodyMap: spec?.text ?? "",
    face: describeFace(source),
    reading,
    correction: null,
    feedback: [],
    mannequin: await withGrid(await fromRgba(mannequin(skeletonFromPose(onCanvas(guides.frames[index - 1], fit)), CANVAS).shaded), marks),
  };
  const { prompt, references } = options.strategy === "structured" ? structuredFramePrompt(input) : framePrompt(input);

  // Provenance first: refused before any call if B isn't the run's character or an output stands in for A or B.
  const target: GenerationTarget = {
    kind: "generation-target", frame: index, attempt: 0,
    pose: { kind: "pose-source", frame: index, file: frame.source, sha256: sha256(await readFile(path.join(run, frame.source))), crop: manifest.crop, layout: fit },
    identity: { kind: "character-identity", file: manifest.character.file, sha256: manifest.character.sha256 },
    references: recordReferences(references),
  };
  const outputs = new Set<string>();
  for (const entry of manifest.frames) for (const attempt of entry.attempts) if (existsSync(path.join(run, attempt.file))) outputs.add(sha256(await readFile(path.join(run, attempt.file))));
  assertIsolation(target, outputs);

  const config = readMetaConfig();
  const size = `${CANVAS.width}x${CANVAS.height}`;
  const body = await imageRequestBody({ prompt, references, size }, config?.imageModel ?? "muse-image-1.0");
  // What actually travels: references over 1024 px go resized, and the record says so.
  const recorded: GenerationTarget = { ...target, references: withSentBytes(target.references, body) };
  await writeFile(path.join(dir, "target.json"), `${JSON.stringify(recorded, null, 2)}\n`);
  await writeFile(path.join(dir, "muse_prompt.txt"), prompt);
  await writeFile(path.join(dir, "muse_request.json"), JSON.stringify({ strategy: options.strategy, endpoint: `${config?.baseUrl ?? "(Meta base URL)"}/responses`, body: await savedRequest(dir, body, references.map((_, i) => `sent_image_${i + 1}.png`)) }, null, 2));

  let generation: PipelineFrameRecord["generation"];
  let checks: Check[] = [];
  let output: Buffer | null = null;
  if (options.generated) {
    output = await readFile(options.generated);
    generation = { source: "file", file: path.resolve(options.generated) };
  } else if (options.dry) generation = { source: "skipped", reason: "dry run: inputs and request only" };
  else {
    const started = Date.now();
    try {
      // One request, never retried: at most one generation.
      const image = await generateImage({ prompt, references, size, signal: options.signal, attempts: 1 });
      const raw = `generated_raw.${image.raw ? rawExtension(image.raw) : "png"}`;
      await writeFile(path.join(dir, raw), image.raw ?? image.png);
      if (image.response) await writeFile(path.join(dir, "muse_response.json"), JSON.stringify(image.response, null, 2));
      generation = { source: "muse", durationMs: Date.now() - started, response: image.response ?? null, raw };
      output = image.png;
      log(`  drawn in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (error) {
      generation = { source: "failed", kind: "api", code: error instanceof AppError ? error.code : null, error: error instanceof Error ? error.message : String(error) };
      log(`  Muse Image failed (API): ${generation.error}`);
    }
  }
  if (output) {
    // Measured exactly as the pipeline measures a drawing (local DWPose, no model call).
    const measured = await measureDrawing(run, index, await toCanvas(output), { work: path.join(dir, "work"), name: "generated" });
    checks = measured.checks;
    await writeFile(path.join(dir, "generated_keyed.png"), measured.keyed);
    const pair = await sideBySide(await readFile(path.join(run, frame.source)), await onColour(measured.placed, "#d8d8d8"));
    await writeFile(path.join(dir, "comparison.png"), pair);
    await writeFile(path.join(dir, "generated_pose.json"), JSON.stringify(measured.drawn));
    // In debug the reviewer always looks, whatever was measured: its verdict is evidence, not the decision.
    if (options.review !== false && config) {
      try {
        const review = await reviewFrame({ character, pair, drawing: await onColour(measured.placed, "#d8d8d8"), previous: null, legs: describeLegs(source), signal: options.signal });
        await writeFile(path.join(dir, "review.json"), JSON.stringify(review, null, 2));
        checks.push(reviewCheck(review));
      } catch (error) {
        checks.push({ name: "review", passed: false, status: "inconclusive", detail: `review unavailable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}` });
      }
    } else checks.push({ name: "review", passed: false, status: "inconclusive", detail: config ? "review switched off" : "review unavailable: no Meta key" });
  }
  const record: PipelineFrameRecord = { mode: "single_frame_debug/pipeline", createdAt, run, frame: index, strategy: options.strategy, target: recorded, reading: reading ? "kept" : "none", generation, checks, verdict: checks.length ? decide(checks) : null };
  await writeFile(path.join(dir, "evaluation.json"), JSON.stringify(record, null, 2));
  await writeFile(path.join(dir, "frame.txt"), `${frameName(index)} of ${path.basename(run)}\n`);
  return { dir, record };
}
