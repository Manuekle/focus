import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import {
  accountExists,
  accountHasSignedIn,
  createAccount,
  destroySession,
  hasAnyAccount,
  startPasswordReset,
} from "@/lib/auth/store";
import { sendAppEmail } from "@/lib/email-send";
import { isFleetRequest } from "@/lib/hosted";
import { renderAccountEmail } from "@/lib/account-email";

// /api/fleet/owner — how the oruka-fleet provisioner hands a hosted tenant to
// its customer (ARCH-5 in the architecture spec; contract in
// docs/hosted-fleet-contract.md).
//
// Hosted tenants run STEVE_SIGNUP_MODE=closed, so nobody who reaches a fresh
// tenant URL can claim it. The fleet instead creates the owner here with a
// random password that is never returned or logged, and sends the existing
// reset-password email: the customer's first act is choosing their own
// password. POST again with the same email to reissue an expired link.
//
// Public in middleware.ts (the fleet has no session); the Bearer fleet token
// is the only way in, and every call on a self-hosted install is a 404.

/** Throwaway password length; nobody ever learns it. */
const SEED_PASSWORD_BYTES = 32;

function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** GET ?email= — whether the owner exists and has signed in yet. */
export const GET = withApiErrors(async function GET(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  const email = readEmail(request.nextUrl.searchParams.get("email"));
  if (!email) return apiError("invalid_field", { field: "email" });
  const exists = await accountExists(email);
  return NextResponse.json({ exists, signedIn: exists && (await accountHasSignedIn(email)) });
});

/** POST {email, locale?} — seed the owner if missing, then send the invite. */
export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  const body = (await request.json().catch(() => null)) as { email?: unknown; locale?: unknown } | null;
  const email = readEmail(body?.email);
  if (!email) return apiError("invalid_field", { field: "email" });

  let created = false;
  if (!(await accountExists(email))) {
    // One owner per tenant. A different address on a tenant that already has
    // accounts is a fleet mistake (wrong slug, edited registry), not a second
    // owner to invent.
    if (await hasAnyAccount()) {
      return apiError("conflict", { message: "This tenant already has an owner with a different email." });
    }
    const password = randomBytes(SEED_PASSWORD_BYTES).toString("base64url");
    const result = await createAccount(email, password);
    if (!result.ok) return apiError("conflict", { detail: result.reason });
    // createAccount signs the new account in. Drop that session: "has signed
    // in" is how the fleet learns the customer took the tenant over.
    await destroySession(result.token);
    created = true;
  }

  const token = await startPasswordReset(email);
  if (!token) return apiError("server_error", { detail: "reset token not issued" });
  const link = new URL(`/reset-password?token=${token}`, request.nextUrl.origin).toString();
  const message = await renderAccountEmail({ link, locale: body?.locale, kind: "invite" });
  const sent = await sendAppEmail({
    to: email,
    ...message,
  });
  // The account stays either way; the fleet records the failed step and the
  // operator reissues once mail works. Unlike forgot-password, nothing here is
  // hidden from the caller: the fleet already knows the address.
  if (!sent.success) {
    console.error(JSON.stringify({ event: "fleet_owner_invite_failed", via: sent.via ?? null, error: sent.error }));
    return apiError("upstream_failed", { detail: `invite email not sent via ${sent.via ?? "?"}` });
  }
  return NextResponse.json({ ok: true, created, via: sent.via });
});
