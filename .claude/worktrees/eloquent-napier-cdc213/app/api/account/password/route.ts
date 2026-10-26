import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import {
  changePassword,
  getSessionAccountEmail,
  loginWithVerifiedEmail,
  MIN_PASSWORD_LENGTH,
  resetPassword,
  SESSION_COOKIE,
  sessionCookie,
  startPasswordReset,
} from "@/lib/auth/store";
import { stampSession, verifyTwoFactor } from "@/lib/auth/two-factor";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/account/password — change the signed-in account's own password.
//
// Different from /api/auth/reset-password: that one runs with no session at
// all, off an emailed token, and drops every open session. This one keeps
// the request's own session alive — see changePassword's comment.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = await getSessionAccountEmail(token);
  if (!email || !token) return apiError("unauthorized");

  let body: { currentPassword?: string; newPassword?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  if (!body.newPassword) return apiError("missing_field", { field: "newPassword" });

  // Forgot the current one but signed in with two-step verification on: a
  // code from the app (lib/auth/two-factor.ts) stands in for it. The password
  // is reset like the emailed link does (every session signed out), and this
  // browser gets a fresh session in the same answer.
  if (!body.currentPassword && body.code) {
    if (!(await rateLimit("account-2fa", `account:${email}`, { max: 5, windowMs: 5 * 60_000 })).allowed) {
      return apiError("rate_limited");
    }
    if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
      return apiError("invalid_field", { field: "newPassword", message: "The new password needs to be at least 10 characters." });
    }
    const check = await verifyTwoFactor(email, body.code, token);
    if (!check.ok) return apiError("invalid_field", { field: "code", message: "That code is not right, or it was already used." });
    const resetToken = await startPasswordReset(email);
    if (!resetToken || !(await resetPassword(resetToken, body.newPassword)).ok) return apiError("server_error");
    const session = await loginWithVerifiedEmail(email);
    await stampSession(email, session.token);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie(session.token, request.nextUrl.protocol === "https:"));
    return response;
  }

  if (!body.currentPassword) return apiError("missing_field", { field: "currentPassword" });

  const result = await changePassword(email, body.currentPassword, body.newPassword, token);
  if (!result.ok) {
    if (result.reason === "wrong_password") return apiError("wrong_password", { field: "currentPassword" });
    return apiError("invalid_field", {
      field: "newPassword",
      message: "The new password needs to be at least 10 characters.",
    });
  }

  return NextResponse.json({ ok: true });
});
