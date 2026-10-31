import { useEffect, useState } from "react";
import { ApiErrorBodySchema } from "../../shared/schemas";
import { BatchSchema, FramePromptSchema, MappingViewSchema, PromptAnalysisSchema, RotoscopeFlipbookSchema, RotoscopeRunSchema, RotoscopeRunSummarySchema, rotoscopeUrls, type CharacterMeasures, type MappingJoint, type Renderer, type RotoscopeBatch, type RotoscopeRun, type RotoscopeRunSummary } from "../../shared/rotoscope";
import { discoverRotoscopeRuns, observeRotoscope } from "../_activity/activity-adapters";
import { getActivityVersion } from "../_activity/activity-store";

export class RotoscopeApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "RotoscopeApiError";
  }
}

function errorFrom(body: unknown, status: number): RotoscopeApiError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  return parsed.success ? new RotoscopeApiError(parsed.data.error.message, parsed.data.error.code) : new RotoscopeApiError("The server couldn’t complete your request. Try again.", `http_${status}`);
}

async function call<T>(url: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  const activityVersion = getActivityVersion();
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new RotoscopeApiError("We couldn’t reach the server. Check your connection and try again.", "network");
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(body, response.status);
  const value = parse(body);
  // Every run read also tells the sidebar's Activity where the run stands.
  if (parse === parseRun && activityVersion === getActivityVersion()) observeRotoscope(value as RotoscopeRun);
  if (parse === parseRunList && activityVersion === getActivityVersion()) discoverRotoscopeRuns(value as RotoscopeRunSummary[]);
  return value;
}

const parseRun = (value: unknown) => RotoscopeRunSchema.parse(value);
const parseRunList = (value: unknown) => RotoscopeRunSummarySchema.array().parse(value);
const parseBatch = (value: unknown) => BatchSchema.parse(value);
const post = (body?: unknown): RequestInit => (body === undefined ? { method: "POST" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const rotoscopeApi = {
  list: () => call("/api/rotoscope/runs", undefined, parseRunList),
  get: (id: string) => call(`/api/rotoscope/runs/${id}`, undefined, parseRun),
  generate: (id: string, options: { dual?: boolean; frame?: number; renderer?: Renderer; prompt?: string; attempts?: number } = {}) => call(`/api/rotoscope/runs/${id}/generate`, post(options), parseRun),
  rename: (id: string, name: string) => call(`/api/rotoscope/runs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, parseRun),
  /** The character's height and weight for the next drawings (a refit places them at the new height ratio). */
  measure: (id: string, measures: CharacterMeasures) => call(`/api/rotoscope/runs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ measures }) }, parseRun),
  /** Lays the run out on the video person's figure and moves its drawings there (local, no AI call). */
  refit: (id: string) => call(`/api/rotoscope/runs/${id}/refit`, post(), parseRun),
  /** A frame's Muse Image prompt: the attempt's, or the next drawing's. */
  prompt: (id: string, frame: number, attempt: number | null) => call(rotoscopeUrls.prompt(id, frame, attempt), undefined, (value) => FramePromptSchema.parse(value)),
  /** Muse Spark reads an edited prompt against the frame's images and an attempt's drawing. */
  analyzePrompt: (id: string, input: { frame: number; attempt: number | null; prompt: string }) => call(`/api/rotoscope/runs/${id}/prompt`, post(input), (value) => PromptAnalysisSchema.parse(value)),
  batch: (id: string) => call(rotoscopeUrls.batch(id), undefined, parseBatch),
  /** Every idle run of the batch draws its first frame once more. */
  drawBatch: (id: string) => call(`${rotoscopeUrls.batch(id)}/draw`, post(), parseBatch),
  stop: (id: string) => call(`/api/rotoscope/runs/${id}/stop`, post(), parseRun),
  approve: (id: string, frame: number, attempt: number) => call(`/api/rotoscope/runs/${id}/approve`, post({ frame, attempt }), parseRun),
  /** A pencil note: the red marks as a transparent PNG at the drawing's size, and what to change. */
  correct: (id: string, note: { frame: number; attempt: number; comment: string; marks: Blob }) => {
    const form = new FormData();
    form.set("frame", String(note.frame));
    form.set("attempt", String(note.attempt));
    form.set("comment", note.comment);
    form.set("marks", note.marks, "marks.png");
    return call(`/api/rotoscope/runs/${id}/correct`, { method: "POST", body: form }, parseRun);
  },
  /** Adds the next seconds of the video as open frames (no drawing yet). */
  extend: (id: string, seconds: number) => call(`/api/rotoscope/runs/${id}/extend`, post({ seconds }), parseRun),
  rebuildGuides: (id: string) => call(`/api/rotoscope/runs/${id}/guides`, post(), parseRun),
  openInFlipbook: (id: string, options: { readonly sound: boolean }) => call(`/api/rotoscope/runs/${id}/flipbook`, post(options), (value) => RotoscopeFlipbookSchema.parse(value)),
  remove: (id: string) => call(`/api/rotoscope/runs/${id}`, { method: "DELETE" }, () => undefined),
  mapping: (id: string, frame: number, attempt: number) => call(rotoscopeUrls.mapping(id, frame, attempt), undefined, (value) => MappingViewSchema.parse(value)),
  /** Measures the frame's attempts drawn before the mapping engine (local pose estimation, no AI call). */
  diagnoseMapping: (id: string, frame: number, attempt: number) => call(rotoscopeUrls.mapping(id, frame, attempt), post(), (value) => MappingViewSchema.parse(value)),
  /** Moved target joints for a frame's next drawing; an empty set clears them. */
  correctMapping: (id: string, frame: number, joints: Partial<Record<MappingJoint, readonly [number, number]>>) =>
    call(`/api/rotoscope/runs/${id}/mapping`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frame, joints }) }, (value) => MappingViewSchema.parse(value)),
};

/** One character of a run or a test batch: the image, its measures, and whether it is already drawn front-on (a saved one). */
export type CharacterInput = { readonly file: File; readonly name?: string; readonly frontOn?: boolean; readonly heightCm: number | null; readonly weightKg: number | null };

type Segment = { readonly video: File; readonly fps: number; readonly start: number; readonly seconds: number | null; readonly name?: string; /** The video person's height, when known: the character is scaled against it. */ readonly personHeightCm: number | null; /** Draw the character in other poses while preparing. */ readonly poseSheet: boolean };
export type CreateRunInput = Segment & { readonly character: CharacterInput };
export type CreateBatchInput = Segment & { readonly characters: readonly CharacterInput[] };

const number = (value: number | null) => (value === null ? "" : String(value));

function segmentForm(input: Segment): FormData {
  const form = new FormData();
  form.set("video", input.video);
  form.set("fps", String(input.fps));
  form.set("start", String(input.start));
  form.set("seconds", input.seconds === null ? "" : String(input.seconds));
  form.set("personHeightCm", number(input.personHeightCm));
  form.set("poseSheet", input.poseSheet ? "1" : "0");
  if (input.name) form.set("name", input.name);
  return form;
}

/** XHR for real upload progress: the video can be large. */
function upload<T>(url: string, form: FormData, parse: (value: unknown) => T | null, onProgress: (fraction: number) => void): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status === 201) {
        const parsed = parse(xhr.response);
        return parsed !== null ? resolve(parsed) : reject(new RotoscopeApiError("We couldn’t read the server’s response. Try again.", "invalid_response"));
      }
      reject(errorFrom(xhr.response, xhr.status));
    };
    xhr.onerror = () => reject(new RotoscopeApiError("The connection was lost during upload. Try again.", "network"));
    xhr.onabort = () => reject(new RotoscopeApiError("Upload canceled.", "aborted"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export function createRun(input: CreateRunInput, onProgress: (fraction: number) => void): { promise: Promise<RotoscopeRun>; abort: () => void } {
  const form = segmentForm(input);
  form.set("character", input.character.file);
  form.set("heightCm", number(input.character.heightCm));
  form.set("weightKg", number(input.character.weightKg));
  if (input.character.frontOn) form.set("frontOn", "1");
  return upload("/api/rotoscope/runs", form, (value) => {
    const parsed = RotoscopeRunSchema.safeParse(value);
    if (parsed.success) observeRotoscope(parsed.data);
    return parsed.success ? parsed.data : null;
  }, onProgress);
}

/** A test batch: the video once and up to four characters, each drawing only its first frame. */
export function createBatch(input: CreateBatchInput, onProgress: (fraction: number) => void): { promise: Promise<RotoscopeBatch>; abort: () => void } {
  const form = segmentForm(input);
  for (const character of input.characters) {
    form.append("character", character.file);
    form.append("characterName", character.name ?? "");
    form.append("frontOn", character.frontOn ? "1" : "0");
    form.append("heightCm", number(character.heightCm));
    form.append("weightKg", number(character.weightKg));
  }
  return upload("/api/rotoscope/batches", form, (value) => {
    const parsed = BatchSchema.safeParse(value);
    if (parsed.success) for (const run of parsed.data.runs) observeRotoscope(run);
    return parsed.success ? parsed.data : null;
  }, onProgress);
}

const busy = (run: RotoscopeRun | null) => run !== null && (run.phase === "preparing" || run.phase === "extending" || run.phase === "generating" || run.phase === "stopping");

/** Follows a run while it prepares or draws; settles to the server's state when it stops. */
export function useRotoscopeRun(id: string | null) {
  const [run, setRun] = useState<RotoscopeRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = busy(run);
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await rotoscopeApi.get(id);
        if (stopped) return;
        setRun(next);
        setError(null);
        if (busy(next)) timer = setTimeout(tick, 2000);
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : "This run couldn’t be loaded.");
        timer = setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
    // Restart polling when an action makes the run busy again.
  }, [id, active]);
  return { run: run?.id === id ? run : null, setRun, error };
}

const batchBusy = (batch: RotoscopeBatch | null) => batch !== null && batch.runs.some((run) => busy(run));

/** Follows a test batch while any of its runs prepares or draws. */
export function useRotoscopeBatch(id: string | null) {
  const [batch, setBatch] = useState<RotoscopeBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = batchBusy(batch);
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await rotoscopeApi.batch(id);
        if (stopped) return;
        setBatch(next);
        setError(null);
        if (batchBusy(next)) timer = setTimeout(tick, 2500);
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : "This batch couldn’t be loaded.");
        timer = setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
    // Restart polling when an action makes a run busy again.
  }, [id, active]);
  return { batch: batch?.id === id ? batch : null, setBatch, error };
}
