import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { createAccessRequest, recordRequestNotification } from "@/lib/access-requests";
import { sendRequestNotice } from "@/lib/access-request-notice";
import { REQUEST_SOURCES, type AccessRequestSource } from "@/lib/access-request-types";
import { calBookingUrlForContact } from "@/lib/cal-booking";

/**
 * Beta access, Enterprise and commercial inquiries from the marketing site.
 * Save the request before emailing the operator, so a
 * notification failure cannot lose a beta application. Everything here
 * assumes the caller is hostile: this route
 * is listed in PUBLIC_PATHS (middleware.ts) precisely because a prospect has
 * no session to send.
 */

const MAX_LEN = { name: 200, email: 320, company: 200, message: 4000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 10 submissions in a ten-minute window per address — a sales form gets
 *  nowhere near the traffic a public webhook does, so the budget is tighter
 *  than the one on /api/f/<slug>. Both now share lib/rate-limit.ts. */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 10;

type DemoRequestBody = {
  readonly name?: unknown;
  readonly email?: unknown;
  readonly company?: unknown;
  readonly message?: unknown;
  /** Honeypot: a real visitor never fills a field named this convincingly
   *  and hidden off-screen. A bot filling every input does. */
  readonly website?: unknown;
  /** Which marketing form sent this. Omitted by older Enterprise forms. */
  readonly source?: unknown;
};

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const limit = await rateLimit("demo-request", request, { max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!limit.allowed) return apiError("rate_limited");

  let body: DemoRequestBody;
  try {
    body = (await request.json()) as DemoRequestBody;
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_body");

  // Honeypot tripped: answer as if it worked, send nothing. Tipping the bot
  // off would just teach it to leave the field blank.
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const name = cleanString(body.name, MAX_LEN.name);
  if (!name) return apiError("missing_field", { field: "name" });

  const email = cleanString(body.email, MAX_LEN.email);
  if (!email || !EMAIL_RE.test(email)) return apiError("invalid_field", { field: "email" });

  const company = cleanString(body.company, MAX_LEN.company);
  if (!company) return apiError("missing_field", { field: "company" });

  if (body.message !== undefined && (typeof body.message !== "string" || body.message.trim().length > MAX_LEN.message)) {
    return apiError("invalid_field", { field: "message" });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const source = body.source === undefined ? "pricing" : body.source;
  if (typeof source !== "string" || !REQUEST_SOURCES.includes(source as AccessRequestSource)) {
    return apiError("invalid_field", { field: "source" });
  }
  const saved = await createAccessRequest({ name, email, company, message, source: source as AccessRequestSource });
  const bookingUrl = calBookingUrlForContact({ name, email });
  const accepted = () => NextResponse.json({ ok: true, ...(bookingUrl ? { bookingUrl } : {}) });
  if (!saved.created) return accepted();
  let sent = false;
  try {
    sent = await sendRequestNotice(saved.request);
    if (!sent) console.error("demo-request: notification failed for", saved.request.id);
  } catch {
    console.error("demo-request: notification failed for", saved.request.id);
  }
  await recordRequestNotification(saved.request.id, sent).catch(() => {
    console.error("demo-request: could not record notification for", saved.request.id);
  });

  return accepted();
});

export const GET = withApiErrors(function GET() {
  return apiError("method_not_allowed", {
    message: "This endpoint only accepts POST from the marketing contact forms.",
  });
});
