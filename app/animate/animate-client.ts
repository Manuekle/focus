import { useEffect, useState } from "react";
import { ApiErrorBodySchema } from "../../shared/schemas";
import {
  AnimationAssetSchema,
  AnimationJobSchema,
  isActiveStatus,
  type AnimationAsset,
  type AnimationJob,
  type AssetKind,
  type CreateJobRequest,
  type EngineAvailability,
  type ImportMethod,
} from "../../shared/reference-motion";

export class AnimateApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AnimateApiError";
  }
}

function errorFrom(body: unknown, status: number): AnimateApiError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  return parsed.success ? new AnimateApiError(parsed.data.error.message, parsed.data.error.code) : new AnimateApiError("The server couldn’t complete your request. Try again.", `http_${status}`);
}

async function call<T>(url: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new AnimateApiError("We couldn’t reach the server. Check your connection and try again.", "network");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(body, response.status);
  return parse(body);
}

const parseJob = (value: unknown) => AnimationJobSchema.parse(value);
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

export const animateApi = {
  engines: () => call("/api/animations/engines", undefined, (value) => value as EngineAvailability),
  list: () => call("/api/animations/jobs", undefined, (value) => AnimationJobSchema.array().parse(value)),
  get: (id: string) => call(`/api/animations/jobs/${id}`, undefined, parseJob),
  create: (request: CreateJobRequest) => call("/api/animations/jobs", json(request), parseJob),
  cancel: (id: string) => call(`/api/animations/jobs/${id}/cancel`, { method: "POST" }, parseJob),
  toFlipbook: (id: string, method: ImportMethod) => call(`/api/animations/jobs/${id}/flipbook`, json({ method }), (value) => value as { flipbookId: string }),
  retry: (id: string) => call(`/api/animations/jobs/${id}/retry`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }, parseJob),
};

export type UploadHandle = { readonly promise: Promise<AnimationAsset>; readonly abort: () => void };

/** XHR for real upload progress, like the clip and character uploads. */
export function uploadAsset(kind: AssetKind, file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<AnimationAsset>((resolve, reject) => {
    xhr.open("POST", `/api/animations/uploads?kind=${kind}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-Focus-Filename", encodeURIComponent(file.name));
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status === 201) {
        const parsed = AnimationAssetSchema.safeParse(xhr.response);
        return parsed.success ? resolve(parsed.data) : reject(new AnimateApiError("We couldn’t read the server’s response. Try again.", "invalid_response"));
      }
      reject(errorFrom(xhr.response, xhr.status));
    };
    xhr.onerror = () => reject(new AnimateApiError("The connection was lost during upload. Try again.", "network"));
    xhr.onabort = () => reject(new AnimateApiError("Upload canceled.", "aborted"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Follows a job while it runs; the server's measured status is shown as is. */
export function useAnimationJob(id: string | null) {
  const [job, setJob] = useState<AnimationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = job ? isActiveStatus(job.status) : false;
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await animateApi.get(id);
        if (stopped) return;
        setJob(next);
        setError(null);
        if (isActiveStatus(next.status)) timer = setTimeout(tick, 1500);
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : "This animation couldn’t be loaded.");
        timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
    // Restart polling when a retry makes the job active again.
  }, [id, active]);
  return { job: job?.id === id ? job : null, setJob, error };
}
