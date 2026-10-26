import { NextResponse, type NextRequest } from "next/server";
import { sendAppEmail } from "@/lib/email-send";
import { startPasswordReset } from "@/lib/auth/store";
import { rateLimit } from "@/lib/rate-limit";
import { renderAccountEmail } from "@/lib/account-email";

/**
 * Always answers `{ ok: true }`, whether or not the email has an account —
 * the same no-enumeration stance as login. Only the email itself (sent or
 * not) tells the requester anything.
 */
export async function POST(request: NextRequest) {
  // Each call sends an email on someone else's say-so, so an unlimited one is
  // a way to use this install as a mailer against an address its owner picks.
  // The 429 is the one answer here that is *not* `{ ok: true }`: it discloses
  // nothing about the address, only that this caller has asked too often.
  const limit = await rateLimit("forgot-password", request, { max: 5, windowMs: 15 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: limit.headers });
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: string; locale?: unknown }
    | null;
  if (!body?.email) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const perAddress = await rateLimit("forgot-password:email", body.email.trim().toLowerCase(), {
    max: 3,
    windowMs: 60 * 60_000,
  });
  if (!perAddress.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: perAddress.headers });
  }

  const token = await startPasswordReset(body.email);
  if (token) {
    const link = new URL(`/reset-password?token=${token}`, request.nextUrl.origin).toString();
    const email = await renderAccountEmail({ link, locale: body.locale, kind: "reset" });
    // The same provider chain as every other email (Resend, then the connected
    // Google account's Gmail, then SMTP). SMTP alone left reset links unsent
    // on an install whose mail goes out through Resend or Gmail.
    const result = await sendAppEmail({
      to: body.email,
      ...email,
    });
    // Not surfaced to the requester — leaking "email isn't configured" would
    // itself confirm the email had an account. It's here for the operator's
    // own server log.
    if (!result.success) {
      console.error(`forgot-password: send via ${result.via ?? "?"} failed:`, result.error);
    }
  }

  return NextResponse.json({ ok: true });
}
