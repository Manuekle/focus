"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ACTIVE_FLIPBOOK_STATUSES,
  ExportRecordSchema,
  FlipbookImageSchema,
  FlipbookSchema,
  FlipbookSummarySchema,
  ImageLookSchema,
  imageUrls,
  type AnimationAction,
  type ExportRequest,
  type Flipbook,
  type FlipbookAction,
  type FlipbookImage,
  type FrameAction,
} from "../../shared/flipbook";
import { ApiErrorBodySchema, VideoAssetSchema } from "../../shared/schemas";
import { LivingInventorySchema, LivingRenderSchema, LivingTrackSchema, livingUrls, type LivingRequest } from "../../shared/living";
import { knownErrorMessage } from "../_editor/messages";

// The browser side of Flipbook: typed calls to /api/flipbooks and a poller
// that follows a flipbook while it works. Codes the editor already words
// (shared guards, Meta errors) use its English copy; Flipbook's own codes
// carry their message. The code decides special flows (budget, sign-in).

const SHARED_CODES = new Set(["ai_disabled", "budget_exhausted", "rate_limited", "login_required", "network"]);
const OWN_WORDING: Readonly<Record<string, string>> = {
  busy: "Too many animations and videos are processing right now. Try again in a minute.",
};
/** What to show for an error code: shared codes in the editor's English wording, Flipbook's own as sent. */
export const messageFor = (code: string, message: string) =>
  OWN_WORDING[code] ?? (((SHARED_CODES.has(code) || code.startsWith("meta_")) && knownErrorMessage(code)) || message);

export class FlipbookApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "FlipbookApiError";
  }
}

async function call<T>(url: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new FlipbookApiError("We couldn’t reach the server. Check your connection and try again.", "network");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ApiErrorBodySchema.safeParse(body);
    throw new FlipbookApiError(error.success ? messageFor(error.data.error.code, error.data.error.message) : "The server couldn’t complete your request. Try again.", error.success ? error.data.error.code : `http_${response.status}`);
  }
  return parse(body);
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const parseFlipbook = (value: unknown) => FlipbookSchema.parse(value);
const upload = (file: File, method: "PUT" | "POST" = "PUT"): RequestInit => ({
  method,
  headers: { "Content-Type": file.type || "application/octet-stream", "X-Focus-Filename": encodeURIComponent(file.name) },
  body: file,
});

export const flipbookApi = {
  create: (imageId: string, prompt: string, options: { action?: AnimationAction; keepScene?: boolean } = {}) =>
    call("/api/flipbooks", json({ imageId, prompt, ...options }), parseFlipbook),
  /** What Focus sees in an upload; read once, then cached with it. */
  look: (imageId: string) => call(imageUrls.look(imageId), { method: "POST" }, (value) => ImageLookSchema.parse(value)),
  get: (id: string) => call(`/api/flipbooks/${id}`, { cache: "no-store" }, parseFlipbook),
  /** The signed-in user's saved animations. */
  list: () => call("/api/flipbooks", { cache: "no-store" }, (value) => FlipbookSummarySchema.array().parse(value)),
  /** Saves to the signed-in account, optionally renaming. */
  save: (id: string, title?: string) => call(`/api/flipbooks/${id}`, json(title ? { title } : {}, "PATCH"), parseFlipbook),
  unsave: (id: string) => call(`/api/flipbooks/${id}`, { method: "DELETE" }, () => undefined),
  /** Opens the animation as a new clip in the video editor. */
  toEditor: (id: string, request: Omit<ExportRequest, "format">) =>
    call(`/api/flipbooks/${id}/editor`, json(request), (value) => {
      const body = value as { flipbook?: unknown; video?: unknown };
      return { flipbook: FlipbookSchema.parse(body.flipbook), video: VideoAssetSchema.parse(body.video) };
    }),
  action: (id: string, action: FlipbookAction) => call(`/api/flipbooks/${id}`, json(action), parseFlipbook),
  frame: (id: string, frameId: string, action: FrameAction) => call(`/api/flipbooks/${id}/frames/${frameId}`, json(action), parseFlipbook),
  replaceFrame: (id: string, frameId: string, file: File) => call(`/api/flipbooks/${id}/frames/${frameId}`, upload(file), parseFlipbook),
  uploadReference: (id: string, file: File) => call(`/api/flipbooks/${id}/reference`, upload(file), parseFlipbook),
  /** One more image of the same character, kept beside the reference. */
  addReference: (id: string, file: File) => call(`/api/flipbooks/${id}/reference`, upload(file, "POST"), parseFlipbook),
  removeReference: (id: string, version: string) => call(`/api/flipbooks/${id}/reference?v=${encodeURIComponent(version)}`, { method: "DELETE" }, parseFlipbook),
  uploadBackground: (id: string, file: File) => call(`/api/flipbooks/${id}/background`, upload(file), parseFlipbook),
  /** "Animate as is": what was found in an upload that can move, or null before anyone looked. */
  living: (imageId: string) => call(livingUrls.layers(imageId), { cache: "no-store" }, (value) => LivingInventorySchema.nullable().parse((value as { inventory?: unknown }).inventory ?? null)),
  /** Finds what can move (paid, once per upload). */
  findLiving: (imageId: string) => call(livingUrls.layers(imageId), { method: "POST" }, (value) => LivingInventorySchema.parse((value as { inventory?: unknown }).inventory)),
  /** Renders the picture in motion (local work; the same request reuses its files). */
  /** The track uploaded for "Animate as is", or null. */
  livingTrack: (imageId: string) => call(livingUrls.audio(imageId), { cache: "no-store" }, (value) => LivingTrackSchema.nullable().parse((value as { track?: unknown }).track ?? null)),
  uploadLivingTrack: (imageId: string, file: File) => call(livingUrls.audio(imageId), upload(file, "POST"), (value) => LivingTrackSchema.parse((value as { track?: unknown }).track)),
  /** The rendered animation as a video-editor clip; saved as a project when signed in. */
  livingToEditor: (imageId: string, key: string) => call(livingUrls.editor(imageId), json({ key }), (value) => {
    const body = value as { video?: unknown; saved?: unknown };
    return { video: VideoAssetSchema.parse(body.video), saved: body.saved === true };
  }),
  renderLiving: (imageId: string, request: LivingRequest) => call(livingUrls.render(imageId), json(request), (value) => LivingRenderSchema.parse((value as { render?: unknown }).render)),
  export: (id: string, request: ExportRequest) =>
    call(`/api/flipbooks/${id}/export`, json(request), (value) => {
      const body = value as { flipbook?: unknown; record?: unknown };
      return { flipbook: FlipbookSchema.parse(body.flipbook), record: ExportRecordSchema.parse(body.record) };
    }),
};

export type UploadHandle = { readonly promise: Promise<FlipbookImage>; readonly abort: () => void };

/** XHR for real upload progress, like the clip upload. */
export function uploadCharacter(file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<FlipbookImage>((resolve, reject) => {
    xhr.open("POST", "/api/flipbooks/images");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-Focus-Filename", encodeURIComponent(file.name));
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        const parsed = FlipbookImageSchema.safeParse(xhr.response);
        if (parsed.success) resolve(parsed.data);
        else reject(new FlipbookApiError("We couldn’t read the server’s response. Try again.", "invalid_response"));
        return;
      }
      const body = ApiErrorBodySchema.safeParse(xhr.response);
      reject(body.success ? new FlipbookApiError(messageFor(body.data.error.code, body.data.error.message), body.data.error.code) : new FlipbookApiError("We couldn’t upload your image. Try again.", `http_${xhr.status}`));
    };
    xhr.onerror = () => reject(new FlipbookApiError("The connection was lost during upload. Try again.", "network"));
    xhr.onabort = () => reject(new FlipbookApiError("Upload canceled.", "aborted"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function isActive(flipbook: Pick<Flipbook, "status"> | null): boolean {
  return Boolean(flipbook && ACTIVE_FLIPBOOK_STATUSES.includes(flipbook.status));
}

/** Follows a flipbook while it works; quiet while it rests. */
export function useFlipbook(initialId: string | null) {
  const [flipbook, setFlipbook] = useState<Flipbook | null>(null);
  const [loadError, setLoadError] = useState<FlipbookApiError | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const id = flipbook?.id ?? initialId;
  const active = isActive(flipbook);

  useEffect(() => {
    if (!initialId) return;
    let canceled = false;
    flipbookApi.get(initialId).then(
      (next) => { if (!canceled) setFlipbook(next); },
      (error) => { if (!canceled) setLoadError(error instanceof FlipbookApiError ? error : new FlipbookApiError("We couldn’t open this animation.", "unknown")); },
    );
    return () => { canceled = true; };
  }, [initialId]);

  useEffect(() => {
    if (!id || !active) return;
    let stopped = false;
    let failures = 0;
    let timer = 0;
    const tick = async () => {
      try {
        const next = await flipbookApi.get(id);
        if (stopped) return;
        failures = 0;
        setPollError(null);
        setFlipbook(next);
      } catch (error) {
        failures++;
        if (failures >= 3) setPollError(error instanceof Error ? error.message : "We lost the connection to your animation.");
      }
      if (!stopped) timer = window.setTimeout(tick, 900);
    };
    timer = window.setTimeout(tick, 600);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id, active]);

  const replace = useCallback((next: Flipbook) => setFlipbook(next), []);
  return { flipbook, setFlipbook: replace, loadError, pollError };
}
