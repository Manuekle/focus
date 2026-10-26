// Turns a failed fetch into a sentence a person can read, in their language.
//
// Nothing in the UI should ever print a bare status code. Every failure funnels
// through here: a route that speaks the `lib/api-error.ts` contract gives us a
// `code` to translate, and anything else (a proxy, a crashed route, an offline
// network) falls back to a status-based key so the wording is still ours.

import type { ApiErrorCode } from "./api-error";

type Translate = (
  key: string,
  params?: Record<string, string | number>,
  fallback?: string,
) => string;

/** Status → code, for responses that carry no `code` of their own. */
function codeForStatus(status: number): ApiErrorCode {
  if (status >= 300 && status < 400) return "not_found";
  switch (status) {
    case 400:
      return "invalid_body";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 408:
      return "timeout";
    case 409:
      return "conflict";
    case 413:
      return "too_large";
    case 422:
      return "unprocessable";
    case 429:
      return "rate_limited";
    case 502:
    case 503:
      return "upstream_failed";
    case 504:
      return "timeout";
    default:
      return status >= 500 ? "server_error" : "invalid_body";
  }
}

export interface ApiErrorInfo {
  readonly code: ApiErrorCode;
  /** Localized sentence, ready to render. */
  readonly message: string;
  /** Which field the server blamed, when it named one. */
  readonly field?: string;
  /** English/technical context. For support and logs, not for the main line. */
  readonly detail?: string;
  readonly status: number;
}

/**
 * What a page holds in state after something failed. Either a request that
 * came back badly, or a local failure that already has a dictionary key.
 *
 * Never a finished sentence: a translated string frozen in state keeps the
 * language it was produced in, so switching to English leaves old Spanish
 * errors on screen.
 */
export type UiError = ApiErrorInfo | { readonly messageKey: string };

/** True for the request-failure half of `UiError`. */
export function isApiError(error: UiError): error is ApiErrorInfo {
  return typeof error === "object" && error !== null && "code" in error;
}

/** The localized sentence for either half of `UiError`. */
export function uiErrorMessage(t: Translate, error: UiError): string {
  return isApiError(error)
    ? translateApiError(t, error.code, error.field)
    : t(error.messageKey);
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && /^[a-z_]+$/.test(value);
}

/**
 * Reads a non-OK `Response` and produces the localized error.
 * Safe on empty bodies, HTML error pages, and non-JSON proxies.
 */
export async function readApiError(response: Response, t: Translate): Promise<ApiErrorInfo> {
  let payload: Record<string, unknown> = {};
  try {
    const text = await response.text();
    if (text.trim().startsWith("{")) payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A body we can't parse tells us nothing the status doesn't already.
  }
  const code = isApiErrorCode(payload.code) ? payload.code : codeForStatus(response.status);
  const field = typeof payload.field === "string" ? payload.field : undefined;
  const detail =
    typeof payload.detail === "string"
      ? payload.detail
      : typeof payload.error === "string"
        ? payload.error
        : undefined;
  return {
    code,
    message: translateApiError(t, code, field),
    field,
    detail,
    status: response.status,
  };
}

/** The localized sentence for a code, with the generic line as the last resort. */
export function translateApiError(t: Translate, code: ApiErrorCode | string, field?: string): string {
  const key = `apiError.${code}`;
  const translated = t(key, field ? { field } : undefined);
  if (translated !== key) return translated;
  const generic = t("apiError.unknown");
  return generic === "apiError.unknown" ? "Something went wrong." : generic;
}

/**
 * One entry in a multi-file upload's `failed[]`.
 *
 * The routes that take several files at once answer 200 with a per-file list
 * rather than one status for the batch, so these never pass through
 * `readApiError`. `key` is the dictionary line; `error` is the English
 * sentence the route also wrote, kept as the fallback for a key no dictionary
 * has yet.
 */
export interface UploadFailure {
  readonly name: string;
  readonly error: string;
  readonly key?: string;
  readonly params?: Record<string, string | number>;
}

/** The localized sentence for one failed file. */
export function failureMessage(t: Translate, failure: UploadFailure): string {
  return failure.key ? t(failure.key, failure.params, failure.error) : failure.error;
}

/**
 * A fetch that never produced a response at all — offline, DNS, an aborted
 * request. Callers catch and pass the thrown value.
 */
export function networkUiError(error: unknown): UiError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { messageKey: "apiError.timeout" };
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return { messageKey: offline ? "apiError.offline" : "apiError.network" };
}

/** Same, already translated — for the few places that need a plain string. */
export function networkErrorMessage(t: Translate, error: unknown): string {
  return uiErrorMessage(t, networkUiError(error));
}

/**
 * The `apiErrorBody` shape, when a 2xx response is carrying one. Success
 * payloads in this app never have a top-level `code`, which is what makes
 * this safe to check on every response.
 */
function apiErrorInBody(
  data: unknown,
): { code: ApiErrorCode; message?: string; field?: string; detail?: string } | null {
  if (!data || typeof data !== "object") return null;
  const body = data as Record<string, unknown>;
  if (!isApiErrorCode(body.code) || typeof body.error !== "string") return null;
  return {
    code: body.code,
    message: typeof body.message === "string" ? body.message : undefined,
    field: typeof body.field === "string" ? body.field : undefined,
    detail: typeof body.detail === "string" ? body.detail : undefined,
  };
}

/**
 * `fetch` that always ends in either data or a localized message — the shape
 * every page in the app now uses for its loads and mutations.
 */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  t: Translate,
  init?: RequestInit,
): Promise<{ readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: UiError }> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (err) {
    return { ok: false, error: networkUiError(err) };
  }
  if (!response.ok) {
    return { ok: false, error: await readApiError(response, t) };
  }
  try {
    const data = (await response.json()) as T;
    // Not every failure comes back with a failing status. `not_configured` is
    // deliberately a 200 — "this integration has no key yet" is a state, not a
    // broken request — so the body has to be checked too. Without this the
    // caller sees `ok: true` and reads fields off an error payload: the
    // billing dialog navigated to `undefined`, and saving a voice agent with
    // no ElevenLabs key handed the page an undefined agent.
    const failure = apiErrorInBody(data);
    if (failure) {
      return {
        ok: false,
        error: {
          code: failure.code,
          message: failure.message ?? translateApiError(t, failure.code, failure.field),
          field: failure.field,
          detail: failure.detail,
          status: response.status,
        },
      };
    }
    return { ok: true, data };
  } catch {
    // A 200 whose body isn't JSON is a broken route, not a bad request.
    return {
      ok: false,
      error: {
        code: "server_error",
        message: translateApiError(t, "server_error"),
        status: response.status,
      },
    };
  }
}
