import { NextResponse, type NextRequest } from "next/server";
import { loginWithVerifiedEmail, sessionCookie } from "@/lib/auth/store";
import { CHALLENGE_COOKIE, answerChallenge, stampSession } from "@/lib/auth/two-factor";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/auth/two-factor `{code}` — the second step of signing in for an
 * account with two-step verification (lib/auth/two-factor.ts). The first step
 * (password, or Google) left a one-time challenge in an httpOnly cookie; a
 * code from the authenticator app, or a recovery code, turns it into the
 * session. Five wrong codes burn the challenge; the address is rate limited
 * on top.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit("login:2fa", request, { max: 10, windowMs: 15 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: limit.headers });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 20) : "";
  if (!code) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const result = await answerChallenge(request.cookies.get(CHALLENGE_COOKIE)?.value, code);
  if (!result.ok) {
    // `expired`: back to the password; `wrong_code`: try again; `locked`: the
    // secret is unreadable here, a recovery code still works.
    return NextResponse.json({ error: result.reason }, { status: result.reason === "expired" ? 410 : 401 });
  }

  const session = await loginWithVerifiedEmail(result.email);
  await stampSession(result.email, session.token);
  const secure = request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true, usedRecovery: result.usedRecovery });
  response.cookies.set(sessionCookie(session.token, secure));
  response.cookies.set({ name: CHALLENGE_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true, secure, sameSite: "lax" });
  return response;
}
