import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { AttemptTraceSchema, type AttemptTrace, type TraceStep, type TraceStepId } from "../../shared/rotoscope";
import { frameName } from "./extract";

// Every attempt's way through the pipeline, step by step, kept beside its pictures in
// work/frame_NNNN_aK_trace.json: what went in (the images and guardrails), what each model and
// tool did with it (the exact prompt, the drawing, the measures, the review) and the decision.
// Written as each step starts and ends, so the run page's Pipeline view follows a drawing live.

export const traceFile = (dir: string, index: number, attempt: number) => path.join(dir, "work", `${frameName(index).replace(".png", "")}_a${attempt}_trace.json`);

type StepPatch = Partial<Omit<TraceStep, "id" | "startedAt">>;

export type Trace = {
  /** Starts a step (status "running"); a step started again is restarted. */
  readonly start: (id: TraceStepId, patch?: StepPatch) => Promise<void>;
  /** Ends a step: "done" unless the patch says otherwise; its time is measured from its start. */
  readonly end: (id: TraceStepId, patch?: StepPatch) => Promise<void>;
  /** Adds to a step without ending it. */
  readonly update: (id: TraceStepId, patch: StepPatch) => Promise<void>;
  /** The step that is running, failed: what broke. */
  readonly fail: (error: unknown) => Promise<void>;
  readonly setBar: (bar: number) => void;
};

export function openTrace(dir: string, index: number, attempt: number, tries: number): Trace {
  const file = traceFile(dir, index, attempt);
  const now = () => new Date().toISOString();
  const trace: AttemptTrace = { frame: index, attempt, tries, startedAt: now(), updatedAt: now(), steps: [], bar: null };
  const started = new Map<TraceStepId, number>();
  // Writes in order: a later state never lands under an earlier one.
  let queue: Promise<void> = mkdir(path.dirname(file), { recursive: true }).then(() => undefined);
  const flush = () => {
    trace.updatedAt = now();
    const text = JSON.stringify(trace);
    queue = queue.then(() => writeFile(file, text)).catch(() => undefined);
    return queue;
  };
  const find = (id: TraceStepId) => trace.steps.find((step) => step.id === id);
  const blank = (id: TraceStepId): TraceStep => ({ id, status: "running", startedAt: now(), ms: null, summary: "", model: null, detail: null, images: [], guardrails: [], metrics: {}, checks: [], score: null });
  return {
    start: (id, patch = {}) => {
      started.set(id, Date.now());
      const step = { ...blank(id), ...patch, status: patch.status ?? "running" } as TraceStep;
      const at = trace.steps.findIndex((entry) => entry.id === id);
      if (at >= 0) trace.steps[at] = step;
      else trace.steps.push(step);
      return flush();
    },
    end: (id, patch = {}) => {
      const step = find(id) ?? (trace.steps.push(blank(id)), find(id)!);
      Object.assign(step, patch, { status: patch.status ?? "done", ms: Date.now() - (started.get(id) ?? Date.parse(step.startedAt)) });
      return flush();
    },
    update: (id, patch) => {
      const step = find(id);
      if (step) Object.assign(step, patch);
      return flush();
    },
    fail: (error) => {
      const step = trace.steps.findLast((entry) => entry.status === "running");
      if (step) Object.assign(step, { status: "failed", ms: Date.now() - (started.get(step.id) ?? Date.parse(step.startedAt)), detail: `${step.detail ? `${step.detail}\n\n` : ""}Error: ${error instanceof Error ? error.message : String(error)}` });
      return flush();
    },
    setBar: (bar) => { trace.bar = bar; },
  };
}

/** Every attempt's trace for a frame, oldest first; attempts drawn before traces were kept have none. */
export async function readFrameTraces(dir: string, index: number): Promise<AttemptTrace[]> {
  const prefix = `${frameName(index).replace(".png", "")}_a`;
  const names = await readdir(path.join(dir, "work")).catch(() => [] as string[]);
  const traces = await Promise.all(names.filter((name) => name.startsWith(prefix) && name.endsWith("_trace.json")).map(async (name) => {
    const parsed = AttemptTraceSchema.safeParse(await readFile(path.join(dir, "work", name), "utf8").then((text) => JSON.parse(text) as unknown, () => null));
    return parsed.success ? parsed.data : null;
  }));
  return traces.flatMap((entry) => (entry ? [entry] : [])).sort((a, b) => a.attempt - b.attempt);
}
