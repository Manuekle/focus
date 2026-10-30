import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors";

// Short-lived capability URLs for the GPU worker. Focus is the object store:
// the worker downloads inputs and uploads outputs through
// /api/animations/worker/:job/:file, and each URL is bound to one job,
// attempt, file name, HTTP method and expiry. Moving to S3 presigned URLs
// replaces only this module and that route.

let devSecret: string | null = null;

function secret(): string {
  const configured = process.env.ANIMATION_URL_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") throw new AppError("gpu_unconfigured", 503, "The animation engine isn’t configured.", "ANIMATION_URL_SECRET must be at least 32 characters.");
  // Development: valid until the process restarts, which also ends its jobs.
  return (devSecret ??= randomBytes(32).toString("hex"));
}

export type SignedTarget = { readonly method: "GET" | "PUT"; readonly jobId: string; readonly attempt: number; readonly name: string };

function signature(target: SignedTarget, expires: number): string {
  return createHmac("sha256", secret()).update(`${target.method}\n${target.jobId}\n${target.attempt}\n${target.name}\n${expires}`).digest("base64url");
}

/** Where the worker reaches Focus. Must be public when the worker runs elsewhere. */
export function callbackBase(): string {
  const base = process.env.ANIMATION_CALLBACK_BASE_URL ?? process.env.FOCUS_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3200}`;
  return base.replace(/\/+$/, "");
}

export function signedUrl(target: SignedTarget, ttlSeconds: number, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const query = new URLSearchParams({ a: String(target.attempt), exp: String(expires), sig: signature(target, expires) });
  return `${callbackBase()}/api/animations/worker/${target.jobId}/${encodeURIComponent(target.name)}?${query}`;
}

/** Throws the same 403 for a wrong, altered or expired signature. */
export function verifySignedRequest(target: Omit<SignedTarget, "attempt">, search: URLSearchParams, now = Date.now()): { attempt: number } {
  const attempt = Number(search.get("a"));
  const expires = Number(search.get("exp"));
  const given = Buffer.from(search.get("sig") ?? "");
  const denied = new AppError("forbidden", 403, "This link is invalid or has expired.");
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(expires) || expires < Math.floor(now / 1000)) throw denied;
  const expected = Buffer.from(signature({ ...target, attempt }, expires));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw denied;
  return { attempt };
}
