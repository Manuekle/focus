import { useEffect, useState } from "react";
import { ApiErrorBodySchema } from "../../shared/schemas";
import { RotoscopeFlipbookSchema, RotoscopeRunSchema, RotoscopeRunSummarySchema, type RotoscopeRun, type RotoscopeRunSummary } from "../../shared/rotoscope";
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
const post = (body?: unknown): RequestInit => (body === undefined ? { method: "POST" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const rotoscopeApi = {
  list: () => call("/api/rotoscope/runs", undefined, parseRunList),
  get: (id: string) => call(`/api/rotoscope/runs/${id}`, undefined, parseRun),
  generate: (id: string, options: { dual?: boolean; frame?: number } = {}) => call(`/api/rotoscope/runs/${id}/generate`, post(options), parseRun),
  rename: (id: string, name: string) => call(`/api/rotoscope/runs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, parseRun),
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
};

export type CreateRunInput = { readonly video: File; readonly character: File; readonly fps: number; readonly start: number; readonly seconds: number | null; readonly name?: string };

/** XHR for real upload progress: the video can be large. */
export function createRun(input: CreateRunInput, onProgress: (fraction: number) => void): { promise: Promise<RotoscopeRun>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.set("video", input.video);
  form.set("character", input.character);
  form.set("fps", String(input.fps));
  form.set("start", String(input.start));
  form.set("seconds", input.seconds === null ? "" : String(input.seconds));
  if (input.name) form.set("name", input.name);
  const promise = new Promise<RotoscopeRun>((resolve, reject) => {
    xhr.open("POST", "/api/rotoscope/runs");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status === 201) {
        const parsed = RotoscopeRunSchema.safeParse(xhr.response);
        if (parsed.success) observeRotoscope(parsed.data);
        return parsed.success ? resolve(parsed.data) : reject(new RotoscopeApiError("We couldn’t read the server’s response. Try again.", "invalid_response"));
      }
      reject(errorFrom(xhr.response, xhr.status));
    };
    xhr.onerror = () => reject(new RotoscopeApiError("The connection was lost during upload. Try again.", "network"));
    xhr.onabort = () => reject(new RotoscopeApiError("Upload canceled.", "aborted"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
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
