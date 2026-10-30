import {
  EngineSchema,
  MAX_SEGMENT_SECONDS,
  WorkerReadySchema,
  WorkerStatusSchema,
  type Engine,
  type EngineAvailability,
  type WorkerManifest,
  type WorkerStatus,
} from "../../shared/reference-motion";
import { AppError } from "../errors";

// HTTP client for the GPU worker (services/animation-worker). The worker is
// private: every call carries the service token, and Focus never forwards
// anything the browser sent except validated, typed values in the manifest.

export function workerConfig() {
  const url = process.env.GPU_WORKER_URL?.replace(/\/+$/, "") || null;
  const engine = EngineSchema.safeParse(process.env.ANIMATION_DEFAULT_ENGINE);
  const max = Number(process.env.ANIMATION_MAX_DURATION_SECONDS);
  return {
    url,
    token: process.env.GPU_WORKER_TOKEN ?? "",
    defaultEngine: engine.success ? engine.data : null,
    maxSegmentSeconds: Number.isFinite(max) && max >= 1 ? Math.min(max, MAX_SEGMENT_SECONDS) : MAX_SEGMENT_SECONDS,
    pollMs: Math.max(500, Number(process.env.ANIMATION_POLL_MS) || 3000),
    /** Whole-job deadline, cold start included. */
    deadlineSeconds: Math.max(60, Number(process.env.ANIMATION_JOB_TIMEOUT_SECONDS) || 45 * 60),
  };
}

const unavailable = (detail: string) => new AppError("GPU_UNAVAILABLE", 503, "The animation engine isn’t available right now. Try again in a few minutes.", detail);

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { url, token } = workerConfig();
  if (!url || !token) throw unavailable("GPU_WORKER_URL / GPU_WORKER_TOKEN not set");
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(`${url}${path}`, { ...init, signal, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw unavailable(`worker unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function availability(): Promise<EngineAvailability> {
  const config = workerConfig();
  const base = { configured: Boolean(config.url && config.token), reachable: false, ready: false, engines: [] as Engine[], defaultEngine: null, gpu: null, gpuHourlyUsd: null, maxSegmentSeconds: config.maxSegmentSeconds };
  if (!base.configured) return { ...base, detail: "No GPU worker is configured." };
  try {
    const response = await call("/readyz", { timeoutMs: 5_000 });
    const body = WorkerReadySchema.safeParse(await response.json().catch(() => null));
    if (!body.success) return { ...base, reachable: true, detail: `Worker answered ${response.status} without a readiness report.` };
    const engines = body.data.engines;
    const defaultEngine = config.defaultEngine && engines.includes(config.defaultEngine) ? config.defaultEngine : engines.find((engine) => engine !== "fake") ?? engines[0] ?? null;
    return { ...base, reachable: true, ready: body.data.ready && engines.length > 0, engines, defaultEngine, gpu: body.data.gpu ?? null, gpuHourlyUsd: body.data.gpuHourlyUsd ?? null, detail: body.data.detail ?? null };
  } catch (error) {
    return { ...base, detail: error instanceof AppError ? "The GPU worker can’t be reached. A sleeping Space may take a few minutes to wake up." : "Readiness check failed." };
  }
}

/** Hands a job to the worker. Idempotent on (jobId, attempt): the worker returns the existing run. */
export async function dispatch(manifest: WorkerManifest, signal: AbortSignal): Promise<WorkerStatus> {
  const response = await call("/internal/jobs", { method: "POST", body: JSON.stringify(manifest), headers: { "Content-Type": "application/json" }, signal });
  if (response.status === 503 || response.status === 429) throw unavailable(`worker refused: ${response.status}`);
  if (!response.ok) throw new AppError("GENERATION_FAILED", 502, "The animation engine refused this job.", `worker ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return WorkerStatusSchema.parse(await response.json());
}

/** null when the worker no longer knows the run (it restarted or slept). */
export async function status(jobId: string, signal: AbortSignal): Promise<WorkerStatus | null> {
  const response = await call(`/internal/jobs/${jobId}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw unavailable(`status ${response.status}`);
  return WorkerStatusSchema.parse(await response.json());
}

export async function cancel(jobId: string): Promise<void> {
  await call(`/internal/jobs/${jobId}/cancel`, { method: "POST", timeoutMs: 5_000 }).catch(() => undefined);
}
