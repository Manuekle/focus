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
  type CreateEnsembleRequest,
  type CycleAction,
  type ExportRequest,
  type Flipbook,
  type FlipbookSummary,
  type FlipbookAction,
  type FlipbookImage,
  type FrameAction,
} from "../../shared/flipbook";
import { ApiErrorBodySchema, VideoAssetSchema } from "../../shared/schemas";
import { FlipbookProposalSchema, type ApplyPoseChangesRequest, type FlipbookChatRequest } from "../../shared/flipbook-chat";
import { LivingInventorySchema, LivingRenderSchema, LivingTrackSchema, livingUrls, type LivingRender, type LivingRequest } from "../../shared/living";
import { knownErrorMessage } from "../_editor/messages";
import type { CharacterSource } from "../../shared/characters";
import type { ViewPreference } from "../../shared/animation-view";
import type { SequenceSettings } from "../../shared/sequence";
import { generationFeedback } from "../_auth/generation-feedback";
import type { FlipbookAudio } from "../../shared/sequence";
import { discoverAnimations, flipbookActivity, observeFlipbook } from "../_activity/activity-adapters";
import { getActivityVersion, trackActivity } from "../_activity/activity-store";

// The browser side of Flipbook: typed calls to /api/flipbooks and a poller
// that follows a flipbook while it works. Codes the editor already words
// (shared guards, Meta errors) use its English copy; Flipbook's own codes
// carry their message. The code decides special flows (budget, sign-in).

const SHARED_CODES = new Set(["ai_disabled", "budget_exhausted", "rate_limited", "login_required", "generation_limit_reached", "quota_unavailable", "network"]);
const OWN_WORDING: Readonly<Record<string, string>> = {
  busy: "Too many animations and videos are processing right now. Try again in a minute.",
  meta_model_not_found: "Animation generation is temporarily unavailable. Your illustration and saved drawings are still here. Please try again later.",
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
  const activityVersion = getActivityVersion();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new FlipbookApiError("We couldn’t reach the server. Check your connection and try again.", "network");
  }
  const body = await response.json().catch(() => null);
  generationFeedback(response, body, init?.method);
  if (!response.ok) {
    const error = ApiErrorBodySchema.safeParse(body);
    throw new FlipbookApiError(error.success ? messageFor(error.data.error.code, error.data.error.message) : "The server couldn’t complete your request. Try again.", error.success ? error.data.error.code : `http_${response.status}`);
  }
  const value = parse(body);
  if (parse === parseFlipbook && activityVersion === getActivityVersion()) observeFlipbook(value as Flipbook);
  if (parse === parseFlipbookList && activityVersion === getActivityVersion()) discoverAnimations(value as FlipbookSummary[]);
  return value;
}

/**
 * "Animate as is" render with its progress: the server streams one JSON line
 * per percent, then the render (or an error). Aborting the signal cancels the
 * render on the server too.
 */
export async function renderLivingWithProgress(imageId: string, request: LivingRequest, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<LivingRender> {
  return trackActivity({ title: "Rendering animation", href: "/flipbook" }, async (update) => {
  let response: Response;
  try {
    response = await fetch(livingUrls.render(imageId), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(request), signal });
  } catch {
    if (signal.aborted) throw new FlipbookApiError("Canceled.", "aborted");
    throw new FlipbookApiError("We couldn’t reach the server. Check your connection and try again.", "network");
  }
  const fail = (body: unknown, status: number) => {
    const error = ApiErrorBodySchema.safeParse(body);
    return new FlipbookApiError(error.success ? messageFor(error.data.error.code, error.data.error.message) : "The server couldn’t complete your request. Try again.", error.success ? error.data.error.code : `http_${status}`);
  };
  if (!response.ok || !response.body) throw fail(await response.json().catch(() => null), response.status);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffer.slice(0, end)) as { progress?: number; render?: unknown; error?: unknown };
        buffer = buffer.slice(end + 1);
        if (typeof line.progress === "number") { onProgress(line.progress); update(line.progress, "Rendering animation…"); }
        if (line.render) return LivingRenderSchema.parse(line.render);
        if (line.error) throw fail(line, response.status);
      }
    }
  } catch (error) {
    if (signal.aborted) throw new FlipbookApiError("Canceled.", "aborted");
    throw error;
  }
  throw new FlipbookApiError("The render stopped before it finished. Try again.", "render_incomplete");
  });
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const parseFlipbook = (value: unknown) => FlipbookSchema.parse(value);
const parseFlipbookList = (value: unknown) => FlipbookSummarySchema.array().parse(value);
const trackFlipbook = (title: string, work: () => Promise<Flipbook>, id?: string) => trackActivity({ title, href: id ? `/flipbook?f=${id}` : "/flipbook", ...(id ? { resource: { kind: "flipbook" as const, id } } : {}) }, work, flipbookActivity);
const ACTION_ACTIVITY: Partial<Record<FlipbookAction["action"], string>> = {
  retry: "Preparing animation", generate: "Generating animation", enhance_flagged: "Repairing drawings",
  sequence: "Planning sequence", inbetweens: "Drawing in-betweens", reference: "Preparing reference",
  scene: "Preparing scene", background: "Generating background", review: "Reviewing animation",
};
const upload = (file: File, method: "PUT" | "POST" = "PUT"): RequestInit => ({
  method,
  headers: { "Content-Type": file.type || "application/octet-stream", "X-Focus-Filename": encodeURIComponent(file.name) },
  body: file,
});

export const flipbookApi = {
  uploadMotion: (id: string, file: File) => call(`/api/flipbooks/${id}/motion`, upload(file, "POST"), parseFlipbook),
  attachMotion: (id: string, input: { version: string; start: number; durationSeconds: number; useAudio: boolean }) => call(`/api/flipbooks/${id}/motion`, json(input), parseFlipbook),
  duplicate: (id: string, target: { imageId?: string; characterSource?: CharacterSource }) => call(`/api/flipbooks/${id}/duplicate`, json(target), parseFlipbook),
  uploadAudio: (id: string, file: File) => call(`/api/flipbooks/${id}/audio`, upload(file, "POST"), parseFlipbook),
  audioSettings: (id: string, settings: Pick<FlipbookAudio, "offset" | "startsAt" | "volume">) => call(`/api/flipbooks/${id}/audio`, json(settings, "PATCH"), parseFlipbook),
  removeAudio: (id: string) => call(`/api/flipbooks/${id}/audio`, { method: "DELETE" }, parseFlipbook),
  create: (imageId: string, prompt: string, options: { action?: CycleAction; keepScene?: boolean; characterSource?: CharacterSource; view?: ViewPreference; sequence?: SequenceSettings; motionSource?: "video"; motionNote?: string } = {}) =>
    trackFlipbook("Preparing animation", () => call("/api/flipbooks", json({ ...(options.characterSource ? {} : { imageId }), prompt, ...options }), parseFlipbook)),
  /** Several saved characters in one scene, as long as `seconds`. */
  createEnsemble: (request: CreateEnsembleRequest) => trackFlipbook("Preparing scene", () => call("/api/flipbooks", json(request), parseFlipbook)),
  /** What Focus sees in an upload; read once, then cached with it. */
  look: (imageId: string) => call(imageUrls.look(imageId), { method: "POST" }, (value) => ImageLookSchema.parse(value)),
  get: (id: string) => call(`/api/flipbooks/${id}`, { cache: "no-store" }, parseFlipbook),
  /** The signed-in user's saved animations. */
  list: () => call("/api/flipbooks", { cache: "no-store" }, parseFlipbookList),
  /** Saves to the signed-in account, optionally renaming. */
  save: (id: string, title?: string) => call(`/api/flipbooks/${id}`, json(title ? { title } : {}, "PATCH"), parseFlipbook),
  unsave: (id: string) => call(`/api/flipbooks/${id}`, { method: "DELETE" }, () => undefined),
  /** Opens the animation as a new clip in the video editor. */
  toEditor: (id: string, request: Omit<ExportRequest, "format">) =>
    call(`/api/flipbooks/${id}/editor`, json(request), (value) => {
      const body = value as { flipbook?: unknown; video?: unknown };
      return { flipbook: FlipbookSchema.parse(body.flipbook), video: VideoAssetSchema.parse(body.video) };
    }),
  action: (id: string, action: FlipbookAction) => {
    const work = () => call(`/api/flipbooks/${id}`, json(action), parseFlipbook);
    const title = ACTION_ACTIVITY[action.action];
    return title ? trackFlipbook(title, work, id) : work();
  },
  frame: (id: string, frameId: string, action: FrameAction) => {
    const work = () => call(`/api/flipbooks/${id}/frames/${frameId}`, json(action), parseFlipbook);
    return action.action === "regenerate" || action.action === "enhance" ? trackFlipbook("Generating drawing", work, id) : work();
  },
  /** Asks the animation assistant (one Muse Spark call). Returns a proposal; nothing is drawn. */
  chat: (id: string, request: FlipbookChatRequest) => call(`/api/flipbooks/${id}/chat`, json(request), (value) => FlipbookProposalSchema.parse(value)),
  /** Redraws the frames of an approved proposal with their new instructions. */
  applyChat: (id: string, request: ApplyPoseChangesRequest) => trackFlipbook("Updating animation", () => call(`/api/flipbooks/${id}/chat/apply`, json(request), parseFlipbook), id),
  replaceFrame: (id: string, frameId: string, file: File) => call(`/api/flipbooks/${id}/frames/${frameId}`, upload(file), parseFlipbook),
  uploadReference: (id: string, file: File) => call(`/api/flipbooks/${id}/reference`, upload(file), parseFlipbook),
  /** One more image of the same character, kept beside the reference. */
  addReference: (id: string, file: File) => call(`/api/flipbooks/${id}/reference`, upload(file, "POST"), parseFlipbook),
  removeReference: (id: string, version: string) => call(`/api/flipbooks/${id}/reference?v=${encodeURIComponent(version)}`, { method: "DELETE" }, parseFlipbook),
  uploadBackground: (id: string, file: File) => call(`/api/flipbooks/${id}/background`, upload(file), parseFlipbook),
  /** A picture of a place that inspires the next generated background (never used as the background itself). */
  uploadBackgroundReference: (id: string, file: File) => call(`/api/flipbooks/${id}/background/reference`, upload(file), parseFlipbook),
  removeBackgroundReference: (id: string) => call(`/api/flipbooks/${id}/background/reference`, { method: "DELETE" }, parseFlipbook),
  /** "Animate as is": what was found in an upload that can move, or null before anyone looked. */
  living: (imageId: string) => call(livingUrls.layers(imageId), { cache: "no-store" }, (value) => LivingInventorySchema.nullable().parse((value as { inventory?: unknown }).inventory ?? null)),
  /** Finds what can move (paid, once per upload). */
  findLiving: (imageId: string) => trackActivity({ title: "Finding movement", href: "/flipbook" }, () => call(livingUrls.layers(imageId), { method: "POST" }, (value) => LivingInventorySchema.parse((value as { inventory?: unknown }).inventory))),
  /** Renders the picture in motion (local work; the same request reuses its files). */
  /** The track uploaded for "Animate as is", or null. */
  livingTrack: (imageId: string) => call(livingUrls.audio(imageId), { cache: "no-store" }, (value) => LivingTrackSchema.nullable().parse((value as { track?: unknown }).track ?? null)),
  uploadLivingTrack: (imageId: string, file: File) => call(livingUrls.audio(imageId), upload(file, "POST"), (value) => LivingTrackSchema.parse((value as { track?: unknown }).track)),
  /** The rendered animation as a video-editor clip; saved as a project when signed in. */
  livingToEditor: (imageId: string, key: string) => call(livingUrls.editor(imageId), json({ key }), (value) => {
    const body = value as { video?: unknown; saved?: unknown };
    return { video: VideoAssetSchema.parse(body.video), saved: body.saved === true };
  }),
  /** Takes the character out of the picture, for the "depth" camera (one drawing for a detailed background). */
  separateLivingScene: (imageId: string) => trackActivity({ title: "Preparing scene layers", href: "/flipbook" }, () => call(livingUrls.scene(imageId), { method: "POST" }, (value) => LivingInventorySchema.parse((value as { inventory?: unknown }).inventory))),
  /** Lets the character blink (one SAM frame and one drawing, once per upload). */
  prepareLivingBlink: (imageId: string) => trackActivity({ title: "Preparing blink", href: "/flipbook" }, () => call(livingUrls.blink(imageId), { method: "POST" }, (value) => LivingInventorySchema.parse((value as { inventory?: unknown }).inventory))),
  /** Adds a part picked with a click on the picture (its pixels). */
  addLivingPart: (imageId: string, x: number, y: number) => call(livingUrls.parts(imageId), json({ x, y }), (value) => LivingInventorySchema.parse((value as { inventory?: unknown }).inventory)),
  removeLivingPart: (imageId: string, layerId: string) => call(`${livingUrls.parts(imageId)}?layer=${encodeURIComponent(layerId)}`, { method: "DELETE" }, (value) => LivingInventorySchema.parse((value as { inventory?: unknown }).inventory)),
  renderLiving: (imageId: string, request: LivingRequest) => call(livingUrls.render(imageId), json(request), (value) => LivingRenderSchema.parse((value as { render?: unknown }).render)),
  export: (id: string, request: ExportRequest, signal?: AbortSignal) =>
    trackActivity({ title: "Exporting animation", href: `/flipbook?f=${id}` }, () => call(`/api/flipbooks/${id}/export`, { ...json(request), signal }, (value) => {
      const body = value as { flipbook?: unknown; record?: unknown };
      return { flipbook: FlipbookSchema.parse(body.flipbook), record: ExportRecordSchema.parse(body.record) };
    })),
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
