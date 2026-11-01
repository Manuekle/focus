import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { PYTHON } from "../mapping/pose-estimator";
import type { Pose } from "./pose-match";
import type { Check } from "./run-state";

// The fidelity gate: every drawing measured against its pose guide, its video frame and the
// previous approved drawing by the worker's Python (services/animation-worker/app/pipeline/fidelity.py,
// NumPy + OpenCV, deterministic, no model call), then judged here. A drawing is approved only when
// its weighted fidelity reaches FIDELITY.overall (95 % by default) and no floor is broken: a missing
// or mirrored limb, a loose fragment or a jump away from the previous frame rejects it whatever its
// average. What is wrong goes back to the next attempt as concrete corrections.

const exec = promisify(execFile);
export const FIDELITY_SCRIPT = path.join(/*turbopackIgnore: true*/ process.cwd(), "services/animation-worker/scripts/rotoscope_fidelity.py");

export const FIDELITY_METRICS = ["pose", "limbs", "integrity", "proportions", "motion", "continuity", "identity", "silhouette"] as const;
export type FidelityMetric = (typeof FIDELITY_METRICS)[number];

/** How much each measure counts in the overall score; silhouette is shown, never counted (costumes differ from the video). */
export const FIDELITY_WEIGHTS: Readonly<Record<FidelityMetric, number>> = {
  pose: 0.25, limbs: 0.25, integrity: 0.15, proportions: 0.1, motion: 0.1, continuity: 0.1, identity: 0.05, silhouette: 0,
};

const envNumber = (name: string, fallback: number, env: Readonly<Record<string, string | undefined>> = process.env) => {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback;
};

/** The gate. FOCUS_ROTOSCOPE_FIDELITY_MIN moves the overall bar (default 95). */
export function fidelityThresholds(env: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    overall: envNumber("FOCUS_ROTOSCOPE_FIDELITY_MIN", 95, env),
    /** A limb bone scoring under this (about 33° off the video's) rejects the drawing on its own. */
    bone: 0.5,
    integrity: 85,
    /** Below this the drawing doesn't look like the previous frame: a jump in the animation. */
    continuity: 80,
    motion: 75,
    identity: 70,
  } as const;
}
export type FidelityThresholds = ReturnType<typeof fidelityThresholds>;

export type FidelityBone = { readonly bone: string; readonly screen: "left" | "right" | null; readonly error: number | null; readonly weight: number; readonly score: number; readonly ratio?: number };
export type FidelityLimb = { readonly limb: string; readonly present: boolean; readonly onGuide: number; readonly onInk: number; readonly score: number };

/** What fidelity.py measured (Report.as_dict). */
export type FidelityReport = {
  readonly metrics: Partial<Record<FidelityMetric | "headSsim" | "colourMatch", number | null>>;
  readonly bones: readonly FidelityBone[];
  readonly limbs: readonly FidelityLimb[];
  readonly joints: readonly { readonly joint: number; readonly error: number | null; readonly oks: number }[];
  readonly fragments: readonly { readonly box: readonly number[]; readonly area: number; readonly share: number }[];
  readonly mirrored: boolean;
  readonly notes: readonly string[];
};

export type FidelityVerdict = {
  /** Weighted mean of the measured metrics, 0–100; null when nothing could be measured. */
  readonly overall: number | null;
  readonly passed: boolean;
  /** Each broken floor, in words. */
  readonly failures: readonly string[];
  /** What the next attempt is told, said to the generator. */
  readonly feedback: readonly string[];
  readonly critical: boolean;
};

/** The weighted mean of the metrics that were measured: a missing one (no previous frame yet) doesn't count against the drawing. */
export function fidelityScore(report: FidelityReport): number | null {
  let [sum, weight] = [0, 0];
  for (const metric of FIDELITY_METRICS) {
    const value = report.metrics[metric];
    if (value === null || value === undefined || !FIDELITY_WEIGHTS[metric]) continue;
    sum += value * FIDELITY_WEIGHTS[metric];
    weight += FIDELITY_WEIGHTS[metric];
  }
  return weight ? Math.round((sum / weight) * 10) / 10 : null;
}

const SIDE = (screen: FidelityBone["screen"]) => (screen ? ` on the ${screen.toUpperCase()} of the image` : "");
const limbName = (bone: string) => bone.replace(/^(left|right) /, "");

export function judgeFidelity(report: FidelityReport, thresholds: FidelityThresholds = fidelityThresholds()): FidelityVerdict {
  const overall = fidelityScore(report);
  const failures: string[] = [];
  const feedback: string[] = [];
  let critical = false;
  if (report.mirrored) {
    critical = true;
    failures.push("mirrored pose");
    feedback.push("The pose is mirrored: a limb on the left of Image 1 must stay on the left of the frame, a raised arm stays the raised one.");
  }
  for (const limb of report.limbs) {
    if (limb.present && limb.onGuide >= 0.5) continue;
    critical = true;
    failures.push(`${limb.limb} ${limb.present ? "not where the video has it" : "missing"}`);
    feedback.push(`Draw the ${limb.limb} whole and attached, exactly where the person's ${limb.limb} is in Image 1.`);
  }
  for (const bone of report.bones) {
    if (bone.score >= thresholds.bone) continue;
    failures.push(`${bone.bone} ${bone.error === null ? "not found" : `${Math.round(bone.error)}° off`}`);
    if (bone.error !== null) feedback.push(`The ${limbName(bone.bone)}${SIDE(bone.screen)} points ${Math.round(bone.error)}° away from the video's: draw it at the angle of Image 1.`);
  }
  for (const bone of report.bones) {
    if (bone.ratio === undefined || bone.ratio <= 1.25) continue;
    failures.push(`${bone.bone} stretched ×${bone.ratio.toFixed(2)}`);
    // No percentages: swapFramePrompt drops feedback sentences that speak of them (they refer to pictures Muse Image doesn't get).
    feedback.push(`The ${limbName(bone.bone)}${SIDE(bone.screen)} is drawn ${bone.ratio.toFixed(1)} times too long: keep the character's own limb length.`);
  }
  if (report.fragments.length) {
    failures.push(`${report.fragments.length} loose fragment${report.fragments.length === 1 ? "" : "s"}`);
    feedback.push("Every part of the figure is one connected drawing: no loose pieces, no extra hand, foot or limb.");
  }
  const below = (metric: FidelityMetric, floor: number) => {
    const value = report.metrics[metric];
    return value !== null && value !== undefined && value < floor ? value : null;
  };
  const integrity = below("integrity", thresholds.integrity);
  if (integrity !== null) failures.push(`limb integrity ${integrity.toFixed(0)} %`);
  const continuity = below("continuity", thresholds.continuity);
  if (continuity !== null) {
    failures.push(`continuity with the previous frame ${continuity.toFixed(0)} %`);
    feedback.push("Draw the character exactly as in the previous frame: the same face, hair, colours, outfit details and line weight.");
  }
  const motion = below("motion", thresholds.motion);
  if (motion !== null) {
    failures.push(`motion from the previous frame ${motion.toFixed(0)} %`);
    feedback.push("Move the body from the previous frame only as the person moves in the video: no jump of an arm, leg or the head.");
  }
  const identity = below("identity", thresholds.identity);
  if (identity !== null) {
    failures.push(`colours ${identity.toFixed(0)} % like the character sheet`);
    feedback.push("Keep the character sheet's colours on the same parts of the outfit.");
  }
  if (overall !== null && overall < thresholds.overall) failures.push(`fidelity ${overall.toFixed(1)} % < ${thresholds.overall} %`);
  return { overall, passed: overall !== null && failures.length === 0, failures, feedback: [...new Set(feedback)], critical };
}

/** The verdict as a check: critical when a limb is missing or mirrored, major otherwise, so a failed one is drawn again. */
export function fidelityCheck(report: FidelityReport, thresholds: FidelityThresholds = fidelityThresholds()): Check {
  const verdict = judgeFidelity(report, thresholds);
  const measured = FIDELITY_METRICS.flatMap((metric) => {
    const value = report.metrics[metric];
    return value === null || value === undefined ? [] : [`${metric} ${value.toFixed(0)}`];
  }).join(", ");
  if (verdict.overall === null) return { name: "fidelity", passed: false, status: "inconclusive", detail: `nothing measurable (${report.notes.join("; ") || "no pose"})` };
  return {
    name: "fidelity",
    passed: verdict.passed,
    detail: `${verdict.overall.toFixed(1)} % (bar ${thresholds.overall} %)${verdict.failures.length ? ` — ${verdict.failures.join("; ")}` : ""}; ${measured}`,
    score: verdict.overall,
    ...(verdict.passed ? {} : { severity: verdict.critical ? "critical" as const : "major" as const, ...(verdict.feedback.length ? { feedback: verdict.feedback.join(" ") } : {}) }),
  };
}

export type FidelityInput = {
  /** Where the spec, report and evidence picture are written: `<stem>_fidelity.json` / `.png`. */
  readonly stem: string;
  readonly drawing: string;
  readonly target: Pose;
  readonly drawn: Pose;
  readonly previous?: { readonly file: string; readonly drawn: Pose | null } | null;
  readonly source?: Pose | null;
  readonly sourcePrevious?: Pose | null;
  readonly sheet?: string | null;
  readonly personMask?: string | null;
  /** The character sheet's pose, in its own pixels: limb lengths are held to the character's. */
  readonly reference?: Pose | null;
};

/** fidelity.py on one drawing. Writes `<stem>_fidelity_spec.json`, `<stem>_fidelity.json` and the evidence picture `<stem>_fidelity.png`. */
export async function measureFidelity(input: FidelityInput, signal?: AbortSignal): Promise<FidelityReport> {
  await mkdir(path.dirname(input.stem), { recursive: true });
  const spec = {
    drawing: input.drawing, target: input.target, drawn: input.drawn,
    ...(input.previous ? { previous: input.previous.file, ...(input.previous.drawn ? { drawnPrevious: input.previous.drawn } : {}) } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.sourcePrevious ? { sourcePrevious: input.sourcePrevious } : {}),
    ...(input.sheet ? { sheet: input.sheet } : {}),
    ...(input.personMask ? { personMask: input.personMask } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
  };
  const specFile = `${input.stem}_fidelity_spec.json`;
  const out = `${input.stem}_fidelity.json`;
  await writeFile(specFile, JSON.stringify(spec));
  await exec(PYTHON, ["-I", FIDELITY_SCRIPT, "--spec", specFile, "--out", out, "--overlay", `${input.stem}_fidelity.png`], { maxBuffer: 16 * 1024 * 1024, signal, timeout: 120_000 });
  return JSON.parse(await readFile(out, "utf8")) as FidelityReport;
}

/** A kept report, or null when the attempt was never measured. */
export async function readFidelity(stem: string): Promise<FidelityReport | null> {
  return readFile(`${stem}_fidelity.json`, "utf8").then((text) => JSON.parse(text) as FidelityReport, () => null);
}
