import { randomUUID } from "node:crypto";
import { getFormBySlug, getFormResponse } from "@/lib/business-store";
import { recordSubmission } from "@/lib/forms/ingest";
import { toPublicView } from "@/lib/forms/public-view";
import { allFields } from "@/lib/forms/scoring";
import type { Form, FormAnswer } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The public half of forms: the only routes in the app a stranger can reach
 * without a session (see PUBLIC_PATHS in middleware.ts). Everything here
 * assumes the caller is hostile — the body is validated field by field against
 * the stored form rather than trusted, and nothing about an unpublished form
 * is disclosed.
 */

// Answers are small; these caps exist so a public endpoint can't be used to
// grow the store without bound.
const MAX_ANSWERS = 100;
const MAX_TEXT = 2000;
const MAX_PICKS = 50;

/** 30 submissions in a five-minute window per address. The counter and its
 *  caveats now live in lib/rate-limit.ts — this route's own copy read the
 *  *first* `X-Forwarded-For` entry, which is the one the caller gets to write,
 *  so a header made the limit disappear. */
const RATE_WINDOW_MS = 5 * 60_000;
const RATE_MAX = 30;

/** What a visitor is allowed to see. The projection itself lives in
 *  lib/forms/public-view.ts, shared with the server-rendered page and with the
 *  builder's preview: three hand-written copies of "the form minus its points"
 *  is three chances for one of them to start leaking. The id rides along here
 *  because a client fetching this endpoint has nothing else to name the form
 *  with. */
function publicView(form: Form) {
  return { id: form.id, ...toPublicView(form) };
}

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const form = await getFormBySlug(slug);
  // A draft is indistinguishable from a form that never existed: whether the
  // operator has a draft called "pricing-2026" is not public information.
  if (!form || form.status !== "published") return apiError("not_found");
  return NextResponse.json({ form: publicView(form) });
});

/**
 * Keep only answers this form can accept, in the shape it expects. An unknown
 * field id, an invented choice, or a 4MB string is dropped rather than stored:
 * the respondent still gets their submission recorded, minus the parts that
 * were not real.
 */
function sanitizeAnswers(form: Form, raw: unknown): readonly FormAnswer[] | null {
  if (!Array.isArray(raw)) return null;
  const fields = new Map(allFields(form).map((field) => [field.id, field]));
  const out: FormAnswer[] = [];
  for (const entry of raw.slice(0, MAX_ANSWERS)) {
    if (!entry || typeof entry !== "object") continue;
    const { fieldId, value } = entry as { fieldId?: unknown; value?: unknown };
    if (typeof fieldId !== "string") continue;
    const field = fields.get(fieldId);
    if (!field) continue;

    if (field.choices) {
      const picked = (Array.isArray(value) ? value : [value])
        .filter((v): v is string => typeof v === "string")
        .filter((id) => field.choices?.some((choice) => choice.id === id))
        .slice(0, MAX_PICKS);
      if (picked.length === 0) continue;
      out.push({ fieldId, value: field.type === "multi_choice" ? picked : picked[0] });
      continue;
    }

    if (typeof value !== "string") continue;
    const text = value.slice(0, MAX_TEXT).trim();
    if (text) out.push({ fieldId, value: text });
  }
  return out;
}

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  const limit = await rateLimit("form-submit", request, { max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!limit.allowed) return apiError("rate_limited");

  const form = await getFormBySlug(slug);
  if (!form || form.status !== "published") return apiError("not_found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const input = body as { answers?: unknown; responseId?: unknown; complete?: unknown };
  const answers = sanitizeAnswers(form, input.answers);
  if (answers === null) return missingField("answers");

  // A response id is a capability: whoever holds it can append to that
  // response. It is a UUID for exactly that reason, and it is only honoured
  // for a response that belongs to this form and is still unfinished — so a
  // guessed id cannot rewrite an answer someone already submitted.
  let responseId: string | undefined;
  if (typeof input.responseId === "string" && input.responseId.length > 0) {
    const existing = await getFormResponse(input.responseId);
    if (existing && existing.formId === form.id && existing.partial) {
      responseId = existing.id;
    }
  }

  const response = await recordSubmission({
    form,
    answers,
    responseId: responseId ?? `fr-${randomUUID()}`,
    complete: input.complete === true,
  });

  // The score stays server-side. The page only needs to know where to go next.
  return NextResponse.json({ ok: true, responseId: response.id });
});
