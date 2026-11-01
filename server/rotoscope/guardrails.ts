import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { promisify } from "node:util";
import { readMetaConfig, type MetaConfig } from "../ai/meta";
import { AppError } from "../errors";
import { PYTHON, POSE_SCRIPT } from "../mapping/pose-estimator";
import { FIDELITY_SCRIPT } from "./fidelity";
import type { Pose } from "./pose-match";
import type { Check, FrameState, Manifest } from "./run-state";

// Guardrails around every rotoscope drawing, in the order a drawing meets them:
//
//   1. preflight   before a run draws anything: the Python tools start (DWPose, fidelity), the Meta
//                  Model API is configured and every model is a Muse model (Muse Spark, SAM, Muse Image).
//                  A broken environment stops the run with the fix, not halfway through a frame.
//   2. inputs      before a frame is drawn: the video frame has a body to follow, the previous frame
//                  is safe to show as the continuity reference.
//   3. prompt      before Muse Image is called: the clauses that keep limbs, sides, identity and the
//                  key colour are in the prompt, whatever Muse Spark rewrote; added back when dropped.
//   4. output      after the drawing: the fidelity gate (fidelity.ts) and the run's other checks.

export type Guardrail = { readonly name: string; readonly passed: boolean; readonly detail: string; readonly blocking?: boolean };

const exec = promisify(execFile);

/** The Muse families this pipeline draws with; any other model is refused. */
const MUSE_MODELS = { plannerModel: /muse-spark/i, imageModel: /muse-image/i, segmentationModel: /^sam-/i } as const;

export function museOnly(config: MetaConfig): Guardrail {
  const wrong = (Object.keys(MUSE_MODELS) as (keyof typeof MUSE_MODELS)[]).filter((key) => !MUSE_MODELS[key].test(config[key]));
  return wrong.length
    ? { name: "muse-models", passed: false, blocking: true, detail: `not a Muse model: ${wrong.map((key) => `${key} = ${config[key]}`).join(", ")}` }
    : { name: "muse-models", passed: true, detail: `${config.plannerModel}, ${config.segmentationModel}, ${config.imageModel}` };
}

/** Why the worker's Python can't start, in words a person can act on; null when it is there. */
export function pythonProblem(python: string = PYTHON): string | null {
  if (existsSync(python)) return null;
  // A venv whose interpreter link points at a Python that was removed (an uv-managed one, say): existsSync follows the
  // link, so the file looks absent while the venv folder is still there.
  let target: string | null = null;
  for (let link = python, hops = 0; hops < 8; hops++) {
    try {
      const next = path.resolve(path.dirname(link), readlinkSync(link));
      target = next;
      link = next;
    } catch {
      break;
    }
  }
  return target ? `the Python environment is broken: ${python} points at ${target}, which no longer exists` : `the Python environment is missing (${python})`;
}

const SETUP_HINT = "Run `pnpm rotoscope:setup` (or set ROTOSCOPE_PYTHON to a Python with the worker's [pose] extras) and draw again.";
let checked: { readonly at: number; readonly result: Guardrail } | null = null;
const PYTHON_CHECK_TTL = 10 * 60_000;

/** The worker's Python imports what DWPose and the fidelity gate need. Cached for ten minutes once it passes. */
export async function pythonTools(): Promise<Guardrail> {
  if (checked && checked.result.passed && Date.now() - checked.at < PYTHON_CHECK_TTL) return checked.result;
  const problem = pythonProblem();
  const missing = [POSE_SCRIPT, FIDELITY_SCRIPT].filter((file) => !existsSync(file));
  let result: Guardrail;
  if (problem) result = { name: "python", passed: false, blocking: true, detail: `${problem}. ${SETUP_HINT}` };
  else if (missing.length) result = { name: "python", passed: false, blocking: true, detail: `missing ${missing.join(", ")}` };
  else {
    result = await exec(PYTHON, ["-I", "-c", "import cv2, numpy, rtmlib, onnxruntime; print(cv2.__version__, numpy.__version__)"], { timeout: 90_000 })
      .then(({ stdout }) => ({ name: "python", passed: true, detail: `DWPose and fidelity tools ready (OpenCV ${stdout.trim().split(" ")[0]})` }))
      .catch((error: unknown) => ({ name: "python", passed: false, blocking: true, detail: `the worker's Python can't load its tools (${error instanceof Error ? error.message.split("\n").find((line) => /Error/.test(line)) ?? error.message.slice(0, 160) : String(error)}). ${SETUP_HINT}` }));
  }
  checked = { at: Date.now(), result };
  return result;
}

/** Every environment guardrail, for the run page and before a run draws. */
export async function preflight(): Promise<Guardrail[]> {
  const config = readMetaConfig();
  return [
    await pythonTools(),
    config ? { name: "meta-api", passed: true, detail: "Meta Model API configured" } : { name: "meta-api", passed: false, blocking: true, detail: "META_API_KEY isn’t set: Muse Spark, SAM and Muse Image can’t be called." },
    ...(config ? [museOnly(config)] : []),
  ];
}

/** Throws the first blocking preflight failure as an AppError the run page shows. */
export async function assertReady(): Promise<Guardrail[]> {
  const results = await preflight();
  const blocking = results.find((result) => !result.passed && result.blocking);
  if (blocking) throw new AppError(blocking.name === "python" ? "pose_unavailable" : blocking.name === "meta-api" ? "meta_unconfigured" : "models_not_muse", 503, `Rotoscope can’t draw: ${blocking.detail}`);
  return results;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const seen = (pose: Pose, i: number) => pose.keypoints[i]?.[0] != null && (pose.scores[i] ?? 0) >= 0.3;
const LIMB_JOINTS: Readonly<Record<string, readonly number[]>> = { "left arm": [5, 7, 9], "right arm": [6, 8, 10], "left leg": [11, 13, 15], "right leg": [12, 14, 16] };

/** The video frame has a body to follow: a torso (blocking without one) and each limb's joints. */
export function sourceGuardrails(source: Pose | undefined): Guardrail[] {
  if (!source) return [{ name: "source-pose", passed: false, blocking: true, detail: "DWPose found no person in this video frame" }];
  const torso = [5, 6, 11, 12].filter((i) => seen(source, i)).length;
  const unsure = Object.entries(LIMB_JOINTS).filter(([, joints]) => !joints.every((i) => seen(source, i))).map(([limb]) => limb);
  return [
    torso >= 3
      ? { name: "source-pose", passed: true, detail: `torso found (${torso}/4 joints)` }
      : { name: "source-pose", passed: false, blocking: true, detail: `only ${torso}/4 torso joints found: no body to follow` },
    { name: "source-limbs", passed: unsure.length === 0, detail: unsure.length ? `not every joint seen: ${unsure.join(", ")} (drawn from the picture and the guide)` : "every limb's joints seen" },
  ];
}

/**
 * The previous frame as Muse Image's continuity reference: only the frame right before this one, only when it is
 * approved, and only when its approval is trustworthy (a person approved it, or it passed the fidelity gate). A
 * drawing that drifted from the sheet is never shown, so copies of copies can't pile up: the character sheet stays
 * the authority on identity, the previous frame only on how it was drawn a moment ago.
 */
export function continuityGuardrail(manifest: Manifest, index: number): { readonly frame: FrameState | null; readonly guardrail: Guardrail } {
  const previous = manifest.frames.find((entry) => entry.index === index - 1);
  if (!previous) return { frame: null, guardrail: { name: "continuity-reference", passed: true, detail: "first frame: drawn from the character sheet alone" } };
  if (previous.status !== "approved" || !previous.approved) return { frame: null, guardrail: { name: "continuity-reference", passed: false, detail: `frame ${previous.index} isn’t approved: no continuity reference` } };
  if (previous.approved.manual) return { frame: previous, guardrail: { name: "continuity-reference", passed: true, detail: `frame ${previous.index} (approved by you)` } };
  const checks: readonly Check[] = previous.attempts.find((attempt) => attempt.attempt === previous.approved!.attempt)?.checks ?? [];
  const fidelity = checks.find((check) => check.name === "fidelity");
  if (fidelity && !fidelity.passed) return { frame: null, guardrail: { name: "continuity-reference", passed: false, detail: `frame ${previous.index} didn’t pass the fidelity gate: not shown, so its errors aren’t copied` } };
  return { frame: previous, guardrail: { name: "continuity-reference", passed: true, detail: `frame ${previous.index}${fidelity ? ` (fidelity ${fidelity.score?.toFixed(1)} %)` : " (approved before the fidelity gate)"}` } };
}

// ── Prompt ──────────────────────────────────────────────────────────────────

/** Each clause the prompt must carry, how to recognise it, and the words added when it was dropped. */
export const PROMPT_CLAUSES = [
  {
    name: "anatomy",
    present: /\b(exactly|only)\s+two\s+arms\b|\bno\s+(extra|additional|duplicated?)\s+(limbs?|arms?|hands?)\b/i,
    text: "Anatomy: exactly two arms, two hands, two legs and two feet, every one attached to the body; five fingers on every visible hand; no extra, missing, fused, duplicated or broken limbs, no third hand, no limb bending the wrong way.",
  },
  {
    name: "sides",
    present: /\bmirror(ed)?\b/i,
    text: "Sides as seen in the picture, never mirrored: a limb on the left of Image 1 stays on the left of the frame.",
  },
  {
    name: "identity",
    present: /\b(preserve|keep)\b[^.]{0,80}\b(face|identity|proportions)\b/i,
    text: "Preserve the character of Image 2 exactly: face, eyes, hair, body proportions, outfit and colours; do not redesign it.",
  },
  {
    name: "background",
    present: /magenta/i,
    text: "Background: perfectly flat solid #FF00FF magenta everywhere; never use magenta on the character.",
  },
  {
    name: "single-figure",
    present: /\bone character\b|\bsingle character\b|\bno other characters\b/i,
    text: "One character only, whole body visible; no other characters, panels, text or watermark.",
  },
] as const;

/** The images the prompt may refer to must all be sent: a prompt naming Image 5 with four images draws from nothing. */
function imageNumbers(prompt: string): number[] {
  return [...prompt.matchAll(/\bImage\s+(\d+)\b/gi)].map((match) => Number(match[1]));
}

export const MAX_PROMPT_CHARACTERS = 8000;

/**
 * The prompt as Muse Image will get it: the mandatory clauses added back when the writer dropped them (as a GUARDRAILS
 * section, so a person reading the prompt sees what was added), and checked against the images sent.
 */
export function guardPrompt(prompt: string, images: number): { readonly prompt: string; readonly guardrails: Guardrail[] } {
  const missing = PROMPT_CLAUSES.filter((clause) => !clause.present.test(prompt));
  const guarded = missing.length ? `${prompt.trim()}\n\nGUARDRAILS\n${missing.map((clause) => clause.text).join("\n")}` : prompt;
  const named = Math.max(0, ...imageNumbers(guarded));
  const guardrails: Guardrail[] = [
    ...PROMPT_CLAUSES.map((clause) => ({ name: `prompt-${clause.name}`, passed: true, detail: missing.includes(clause) ? "added: the written prompt had dropped it" : "present" })),
    named > images
      ? { name: "prompt-images", passed: false, blocking: true, detail: `the prompt names Image ${named} but only ${images} images are sent` }
      : { name: "prompt-images", passed: true, detail: `${images} labelled images` },
    guarded.length > MAX_PROMPT_CHARACTERS
      ? { name: "prompt-length", passed: false, blocking: true, detail: `${guarded.length} characters, more than ${MAX_PROMPT_CHARACTERS}` }
      : { name: "prompt-length", passed: true, detail: `${guarded.length} characters` },
  ];
  return { prompt: guarded, guardrails };
}

/** The first blocking guardrail that failed, or null. */
export const blocked = (guardrails: readonly Guardrail[]) => guardrails.find((guardrail) => !guardrail.passed && guardrail.blocking) ?? null;
