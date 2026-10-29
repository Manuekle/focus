"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIVE_JOB_STATUSES, ApiErrorBodySchema, EditJobSchema, type EditJob } from "../../shared/schemas";
import type { RenderParamsInput } from "../../shared/render";
import { TrackingSchema, type Tracking } from "../../shared/tracking";
import { editorErrorMessage } from "./messages";
import { generationFeedback } from "../_auth/generation-feedback";
import { editActivity, observeEdit } from "../_activity/activity-adapters";
import { getActivityVersion, trackActivity } from "../_activity/activity-store";

export class ApiRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  const activityVersion = getActivityVersion();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiRequestError("We couldn’t reach the server. Check your connection and try again.", "network");
  }
  const body = await response.json().catch(() => null);
  generationFeedback(response, body, init?.method);
  if (!response.ok) {
    const error = ApiErrorBodySchema.safeParse(body);
    throw new ApiRequestError(error.success ? editorErrorMessage(error.data.error.code) : "The server couldn’t complete your request. Try again.", error.success ? error.data.error.code : `http_${response.status}`);
  }
  const value = parse(body);
  if (parse === parseJob && activityVersion === getActivityVersion()) observeEdit(value as EditJob);
  return value;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const parseJob = (value: unknown) => EditJobSchema.parse(value);

export const jobApi = {
  create: (body: { videoId: string; effect: string; prompt: string }) => trackActivity({ title: "Video effect", href: `/editor?v=${body.videoId}` }, () => call("/api/edits", json(body), parseJob), editActivity),
  get: (id: string) => call(`/api/jobs/${id}`, { cache: "no-store" }, parseJob),
  cancel: (id: string) => call(`/api/jobs/${id}/cancel`, { method: "POST" }, parseJob),
  select: (id: string, objectIds: readonly string[]) => call(`/api/jobs/${id}/selection`, json({ objectIds }), parseJob),
  reopen: (id: string) => call(`/api/jobs/${id}/selection`, { method: "DELETE" }, parseJob),
  refine: (id: string, frameIndex: number, point: { x: number; y: number }) =>
    call(`/api/jobs/${id}/refine`, json({ frameIndex, point }), parseJob),
  fill: (id: string) => call(`/api/jobs/${id}/fill`, { method: "POST" }, parseJob),
  render: (id: string, params?: RenderParamsInput) => call(`/api/jobs/${id}/render`, json({ params }), parseJob),
  chat: (id: string, message: string) => trackActivity({ title: "Editing video", resource: { kind: "edit", id } }, () => call(`/api/jobs/${id}/chat`, json({ message }), parseJob), editActivity),
  restore: (id: string, messageId: string) => call(`/api/jobs/${id}/chat`, json({ restore: messageId }), parseJob),
  tracking: (id: string) => call(`/api/jobs/${id}/tracking`, undefined, (value) => TrackingSchema.parse(value)),
};

/** Polls a job while it is active; loads its tracking once masks exist. */
export function useJob(initial: EditJob | null) {
  const [job, setJob] = useState<EditJob | null>(initial);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const loadedTracking = useRef<string | null>(null);

  const active = job ? ACTIVE_JOB_STATUSES.includes(job.status) : false;
  const jobId = job?.id;

  useEffect(() => {
    if (!jobId || !active) return;
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      try {
        const next = await jobApi.get(jobId);
        if (stopped) return;
        failures = 0;
        setPollError(null);
        setJob(next);
      } catch (error) {
        failures++;
        if (failures >= 3) setPollError(error instanceof Error ? error.message : "We lost the connection to your edit. Reconnect to see its progress.");
      }
      if (!stopped) timer = window.setTimeout(tick, 700);
    };
    let timer = window.setTimeout(tick, 500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobId, active]);

  // Tell the person when the browser itself is offline, before polls fail.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const segmentationId = job?.segmentationId ?? null;
  const ready = job && segmentationId && !active && job.objects.length > 0;
  useEffect(() => {
    if (!ready || !jobId || !segmentationId || loadedTracking.current === segmentationId) return;
    loadedTracking.current = segmentationId;
    jobApi.tracking(jobId).then(setTracking, () => {
      loadedTracking.current = null;
    });
  }, [ready, jobId, segmentationId]);

  const reset = () => {
    setJob(null);
    setTracking(null);
    setPollError(null);
    loadedTracking.current = null;
  };

  const connectionError = offline ? "You’re offline. Your edit is still processing and its progress will update when you reconnect." : pollError;
  return { job, setJob, tracking, pollError: connectionError, reset };
}
