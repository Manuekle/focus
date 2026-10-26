import { NextResponse, type NextRequest } from "next/server";
import { MIN_PASSWORD_LENGTH, resetPassword, startPasswordReset } from "@/lib/auth/store";
import { proveForPasswordReset } from "@/lib/auth/two-factor";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/auth/forgot-password/two-factor `{email, code, recoveryCode, password}`
 *
 * The way back in without email, for an account with two-step verification
 * (lib/auth/two-factor.ts): a current code from the authenticator app AND
 * one unused recovery code (spent) prove the account, and the new password
 * is set. Every other session on the account is signed out, as with the
 * emailed link. One answer for every failure, so the route says nothing
 * about which addresses have accounts or 2FA.
 */
export async function POST(request: NextRequest) {
  const byAddress = await rateLimit("forgot-2fa:ip", request, { max: 5, windowMs: 15 * 60_000 });
  if (!byAddress.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: byAddress.headers });

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; code?: unknown; recoveryCode?: unknown; password?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const recoveryCode = typeof body?.recoveryCode === "string" ? body.recoveryCode : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !code || !recoveryCode || !password) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  // Checked before the proof, which spends the recovery code.
  if (password.length < MIN_PASSWORD_LENGTH) return NextResponse.json({ error: "weak_password" }, { status: 400 });

  const byAccount = await rateLimit("forgot-2fa:email", email, { max: 5, windowMs: 60 * 60_000 });
  if (!byAccount.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: byAccount.headers });

  const refused = NextResponse.json({ error: "invalid_codes" }, { status: 400 });
  if (!(await proveForPasswordReset(email, code, recoveryCode))) return refused;
  const token = await startPasswordReset(email);
  if (!token || !(await resetPassword(token, password)).ok) return refused;
  return NextResponse.json({ ok: true });
}
