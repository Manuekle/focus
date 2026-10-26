import { NextResponse, type NextRequest } from "next/server";
import { claimState, createAccount, sessionCookie } from "@/lib/auth/store";
import { decideSignup } from "@/lib/auth/signup-policy";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Self-signup, gated. Public by necessity — the person opening a fresh
 * install has no session to send — so who gets through is decided by
 * lib/auth/signup-policy.ts rather than by "whoever asked". Read the comment
 * at the top of that file: one account here is full access to the whole
 * installation, including its plaintext credential export.
 */
export async function POST(request: NextRequest) {
  const limit = await rateLimit("register", request, { max: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: limit.headers });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    inviteCode?: string;
  } | null;

  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const decision = decideSignup({
    email: body.email,
    inviteCode: body.inviteCode ?? request.headers.get("x-signup-invite") ?? undefined,
    claim: await claimState(),
  });
  if (!decision.allowed) {
    // 503 for "the database did not answer", because that is a retryable
    // condition on our side and not a judgement about the caller. 403 for the
    // two that are.
    return NextResponse.json(
      { error: decision.reason },
      { status: decision.reason === "unavailable" ? 503 : 403 },
    );
  }

  const result = await createAccount(body.email, body.password);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "email_exists" ? "email_exists" : "invalid" },
      { status: result.reason === "email_exists" ? 409 : 400 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(result.token, request.nextUrl.protocol === "https:"));
  return response;
}
