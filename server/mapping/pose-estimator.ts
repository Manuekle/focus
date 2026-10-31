import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { Pose } from "../rotoscope/pose-match";
import { skeletonFromPose, torsoLength } from "./skeleton";

// Whole-body pose estimation for the mapping engine, in the worker's Python
// environment (rtmlib + ONNX Runtime): the web server never loads a model or
// a GPU library. ROTOSCOPE_POSE_DEVICE=cuda runs it on a GPU host with
// onnxruntime-gpu installed; ROTOSCOPE_PYTHON points at another environment.
// Two estimators are available, both RTMW whole-body (COCO-WholeBody, 133
// points) with the YOLOX detector trained on HumanArt (which includes
// cartoon and anime figures): "performance" (RTMW-x 384×288, the default
// after the benchmark in docs/sam-character-mapping.md) and "balanced"
// (RTMW-x 256×192). When the first finds no torso, the other is tried.

const exec = promisify(execFile);
// Runtime tools, not source: keep them out of Turbopack's file tracing.
export const PYTHON = process.env.ROTOSCOPE_PYTHON ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "services/animation-worker/.venv/bin/python");
export const POSE_SCRIPT = path.join(/*turbopackIgnore: true*/ process.cwd(), "services/animation-worker/scripts/rotoscope_pose.py");

export type EstimatorMode = "performance" | "balanced";
export const ESTIMATOR_NAMES: Readonly<Record<EstimatorMode, string>> = { performance: "rtmw-x-384x288", balanced: "rtmw-x-256x192" };

export type PoseFile = { width: number; height: number; files?: string[]; frames: Pose[] };

export function poseToolAvailable(): boolean {
  return existsSync(PYTHON) && existsSync(POSE_SCRIPT);
}

export async function runPoseTool(args: readonly string[]): Promise<void> {
  await exec(PYTHON, ["-I", POSE_SCRIPT, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

const primary = (): EstimatorMode => (process.env.ROTOSCOPE_POSE_MODE === "balanced" ? "balanced" : "performance");
const device = () => (["cuda", "mps"].includes(process.env.ROTOSCOPE_POSE_DEVICE ?? "") ? process.env.ROTOSCOPE_POSE_DEVICE! : "cpu");

export type Estimate = { readonly pose: Pose; readonly estimator: string; readonly fallback: boolean };

/** Detects one image; `out` keeps the JSON next to it. */
export type PoseEstimator = (image: string, out: string, mode: EstimatorMode) => Promise<Pose | null>;

export const localEstimator: PoseEstimator = async (image, out, mode) => {
  await runPoseTool(["detect", "--image", image, "--out", out, "--mode", mode, "--device", device()]);
  return (JSON.parse(await readFile(out, "utf8")) as PoseFile).frames[0] ?? null;
};

/** One image's pose, with the other estimator as the fallback when the first finds no torso. */
export async function estimatePose(image: string, out: string, estimator: PoseEstimator = localEstimator): Promise<Estimate | null> {
  const first = primary();
  const order: EstimatorMode[] = first === "performance" ? ["performance", "balanced"] : ["balanced", "performance"];
  for (const [i, mode] of order.entries()) {
    const target = i === 0 ? out : out.replace(/\.json$/, `.${mode}.json`);
    const pose = await estimator(image, target, mode).catch(() => null);
    if (pose && torsoLength(skeletonFromPose(pose))) return { pose, estimator: ESTIMATOR_NAMES[mode], fallback: i > 0 };
  }
  return null;
}
