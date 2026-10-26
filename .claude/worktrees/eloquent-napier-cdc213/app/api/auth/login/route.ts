import { NextResponse, type NextRequest } from "next/server";
import { destroySession, login, sessionCookie } from "@/lib/auth/store";
import { challengeCookie, createChallenge, requiresTwoFactor } from "@/lib/auth/two-factor";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Rate limited two ways: per address, and per address+email.
 *
 * scrypt at N=16384 costs ~100ms a try, which used to be the whole throttle
 * here — the argument being that a shared counter needs shared state this app
 * did not have. It has Postgres now, and more to the point 100ms is ~36,000
 * guesses an hour against a password floor of ten characters. That is a
 * throttle on one attacker's convenience, not on credential stuffing.
 *
 * The per-address budget is the wide one, so a shared office NAT is not locked
 * out by one person's typo. The per-email budget is the tight one, because
 * guessing *one* account's password is what an attacker is actually doing, and
 * it is keyed on the email rather than the address so rotating through proxies
 * does not reset it. See lib/rate-limit.ts for what the in-memory counter does
 * and does not promise.
 */
export async function POST(request: NextRequest) {
  const byAddress = await rateLimit("login:ip", request, { max: 30, windowMs: 15 * 60_000 });
  if (!byAddress.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: byAddress.headers });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;

  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const byAccount = await rateLimit("login:email", body.email.trim().toLowerCase(), {
    max: 10,
    windowMs: 15 * 60_000,
  });
  if (!byAccount.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: byAccount.headers });
  }

  const result = await login(body.email, body.password);
  if (!result.ok) {
    // "The database did not answer" is not "wrong password", and answering 401
    // for it tells someone with correct credentials that they are wrong. 503
    // says retry, which is the truth and what the client should act on.
    if (result.reason === "unavailable") {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    // One message for both halves of a genuine failure. "That email does not
    // exist" is a way of asking the server to confirm addresses.
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const secure = request.nextUrl.protocol === "https:";
  // Two-step verification on (lib/auth/two-factor.ts): the password is only
  // the first factor. The session `login` just issued is withdrawn, and a
  // one-time challenge (httpOnly cookie) waits for the code at
  // /api/auth/two-factor.
  if (await requiresTwoFactor(body.email)) {
    await destroySession(result.token);
    const ticket = await createChallenge(body.email);
    const response = NextResponse.json({ ok: true, twoFactor: true });
    response.cookies.set(challengeCookie(ticket, secure));
    return response;
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(result.token, secure));
  return response;
}
