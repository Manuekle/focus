import { createHash } from "node:crypto";
import sharp from "sharp";
import { createHiggsfieldClient, type V2Response } from "@higgsfield/client/v2";
import { AppError } from "../errors";
import type { ImageReference } from "../animation/muse-image";

// Higgsfield as the rotoscope's second generator: the same frame prompt and
// the same reference images Muse Image gets, drawn by another model, so the
// pipeline can keep whichever drawing measures closer to the pose. Server
// side only: HF_CREDENTIALS ("key-id:key-secret") is read here at runtime and
// never logged or sent to the browser.

/** An image model on Higgsfield that takes reference images (`image_urls`). */
const MODEL = () => process.env.HIGGSFIELD_IMAGE_MODEL || "xai/grok-imagine-image-2.0";
/** References travel at most this large, like Muse Image's. */
const REFERENCE_LONG_SIDE = 1024;

function credentials(): { joined: string } | null {
  const joined = process.env.HF_CREDENTIALS?.trim();
  const at = joined?.indexOf(":") ?? -1;
  if (!joined || at <= 0 || at === joined.length - 1) return null;
  return { joined };
}

/** True when HF_CREDENTIALS is set in the "key-id:key-secret" form. */
export function higgsfieldConfigured(): boolean {
  return credentials() !== null;
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

/** The SDK has no AbortSignal: a stop abandons the wait (Higgsfield finishes the job on its side). */
function race<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * Uploads one reference and returns its public URL. The SDK's own uploader (the v1 client) still
 * sends the old hf-api-key / hf-secret headers, which the API now answers with 403; the documented
 * header is `Authorization: Key <id>:<secret>`, the one the v2 client already sends. The upload
 * URL is signed over the headers the API returns with it (`upload_headers`, x-amz-tagging
 * included): the PUT sends exactly those.
 */
async function upload(png: Buffer, credentials: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch("https://api.higgsfield.ai/files/generate-upload-url", {
    method: "POST",
    headers: { Authorization: `Key ${credentials}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: "image/png" }),
    signal,
  });
  if (!response.ok) throw new AppError("higgsfield_upload", 502, "The reference images couldn’t be sent to Higgsfield.", `HTTP ${response.status}`);
  const { upload_url: target, public_url: url, upload_headers: headers } = await response.json() as { upload_url?: string; public_url?: string; upload_headers?: Record<string, string> };
  if (!target || !url) throw new AppError("higgsfield_upload", 502, "The reference images couldn’t be sent to Higgsfield.", "no upload URL");
  const put = await fetch(target, { method: "PUT", headers: headers ?? { "Content-Type": "image/png" }, body: new Uint8Array(png), signal });
  if (!put.ok) throw new AppError("higgsfield_upload", 502, "The reference images couldn’t be sent to Higgsfield.", `upload HTTP ${put.status}`);
  return url;
}

async function uploadable(png: Buffer): Promise<Buffer> {
  return sharp(png).resize(REFERENCE_LONG_SIDE, REFERENCE_LONG_SIDE, { fit: "inside", withoutEnlargement: true, kernel: "lanczos3" }).png().toBuffer();
}

// Most references repeat on every frame (the character sheet, the pose sheet):
// each distinct image is resized and uploaded once and its URL reused for a
// while, instead of two HTTP round trips per reference per frame.
const UPLOAD_TTL_MS = 30 * 60_000;
const uploads = ((globalThis as { __focusHiggsfieldUploads?: Map<string, { url: Promise<string>; at: number }> }).__focusHiggsfieldUploads ??= new Map());

function uploadOnce(png: Buffer, credentials: string, signal?: AbortSignal): Promise<string> {
  const now = Date.now();
  for (const [key, entry] of uploads) if (now - entry.at > UPLOAD_TTL_MS) uploads.delete(key);
  const key = createHash("sha256").update(png).digest("hex");
  const kept = uploads.get(key);
  if (kept) return kept.url;
  const url = uploadable(png).then((resized) => upload(resized, credentials, signal));
  uploads.set(key, { url, at: now });
  // A failed or stopped upload is not remembered.
  url.catch(() => uploads.delete(key));
  return url;
}

function failure(result: V2Response): AppError {
  const status = String(result.status);
  if (status === "nsfw") return new AppError("higgsfield_moderated", 422, "Higgsfield’s moderation declined this drawing.");
  if (status === "failed") return new AppError("higgsfield_failed", 502, "Higgsfield couldn’t draw this frame.", `request ${result.request_id}`);
  if (status === "canceled" || status === "cancelled") return new AppError("higgsfield_canceled", 502, "Higgsfield canceled this drawing.", `request ${result.request_id}`);
  return new AppError("higgsfield_incomplete", 502, `Higgsfield didn’t finish the drawing (status ${status}).`, `request ${result.request_id}`);
}

/**
 * One frame drawn by Higgsfield. Its API takes plain image URLs, so each
 * reference is uploaded first and its role is spelled out in the prompt by
 * position ("Image 2: …"), the way Muse Image is told before each image.
 */
export async function generateHiggsfield(input: {
  readonly prompt: string;
  readonly references: readonly ImageReference[];
  /** "2:3" for the rotoscope canvas. */
  readonly aspectRatio: string;
  readonly signal?: AbortSignal;
}): Promise<Buffer> {
  const auth = credentials();
  if (!auth) throw new AppError("higgsfield_unconfigured", 503, "Higgsfield isn’t configured on this server (HF_CREDENTIALS).");
  aborted(input.signal);
  const urls = await Promise.all(input.references.map((reference) => uploadOnce(reference.png, auth.joined, input.signal)));
  const roles = input.references.map((reference, index) => `Image ${index + 1}: ${reference.role}`).join("\n");
  const client = createHiggsfieldClient({ credentials: auth.joined, maxPollTime: 6 * 60_000 });
  let result: V2Response;
  try {
    result = await race(client.subscribe(MODEL(), {
      input: { prompt: `${roles}\n\n${input.prompt}`, image_urls: urls, aspect_ratio: input.aspectRatio, resolution: "2k", quality: "medium" },
      withPolling: true,
    }), input.signal);
  } catch (error) {
    if (input.signal?.aborted || error instanceof AppError) throw error;
    // SDK errors carry the API's message, never the credentials.
    throw new AppError("higgsfield_error", 502, "Higgsfield couldn’t draw this frame.", error instanceof Error ? error.message.slice(0, 300) : String(error));
  }
  const url = result.status === "completed" ? result.images?.[0]?.url : undefined;
  if (!url) throw failure(result);
  const response = await fetch(url, { signal: input.signal });
  if (!response.ok) throw new AppError("higgsfield_download", 502, "Higgsfield’s drawing couldn’t be downloaded.", `HTTP ${response.status}`);
  try {
    return await sharp(Buffer.from(await response.arrayBuffer()), { failOn: "error" }).toColourspace("srgb").ensureAlpha().png().toBuffer();
  } catch {
    throw new AppError("higgsfield_unreadable", 502, "Higgsfield returned an image we couldn’t read.");
  }
}
