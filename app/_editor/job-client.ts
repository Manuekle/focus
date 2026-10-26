"use client";

import { useEffect, useRef, useState } from "react";
import { ACTIVE_JOB_STATUSES, ApiErrorBodySchema, EditJobSchema, type EditJob } from "../../shared/schemas";
import type { RenderParams } from "../../shared/render";
import { TrackingSchema, type Tracking } from "../../shared/tracking";

export class ApiRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiRequestError("Sin conexión con el servidor. Revisa tu red y vuelve a intentarlo.", "network");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ApiErrorBodySchema.safeParse(body);
    throw new ApiRequestError(error.success ? error.data.error.message : "El servidor no pudo completar la solicitud.", error.success ? error.data.error.code : `http_${response.status}`);
  }
  return parse(body);
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const parseJob = (value: unknown) => EditJobSchema.parse(value);

export const jobApi = {
  create: (body: { videoId: string; effect: string; prompt: string }) => call("/api/edits", json(body), parseJob),
  get: (id: string) => call(`/api/jobs/${id}`, { cache: "no-store" }, parseJob),
  cancel: (id: string) => call(`/api/jobs/${id}/cancel`, { method: "POST" }, parseJob),
  select: (id: string, objectIds: readonly string[]) => call(`/api/jobs/${id}/selection`, json({ objectIds }), parseJob),
  reopen: (id: string) => call(`/api/jobs/${id}/selection`, { method: "DELETE" }, parseJob),
  refine: (id: string, frameIndex: number, point: { x: number; y: number }) =>
    call(`/api/jobs/${id}/refine`, json({ frameIndex, point }), parseJob),
  fill: (id: string) => call(`/api/jobs/${id}/fill`, { method: "POST" }, parseJob),
  render: (id: string, params?: RenderParams) => call(`/api/jobs/${id}/render`, json({ params }), parseJob),
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
        if (failures >= 3) setPollError(error instanceof Error ? error.message : "Se perdió el seguimiento del proceso.");
      }
      if (!stopped) timer = window.setTimeout(tick, 700);
    };
    let timer = window.setTimeout(tick, 500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobId, active]);

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

  return { job, setJob, tracking, pollError, reset };
}
