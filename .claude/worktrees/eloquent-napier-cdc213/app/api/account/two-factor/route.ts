import { type NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { apiError, withApiErrors } from "@/lib/api-error";
import { SESSION_COOKIE, getSessionAccountEmail } from "@/lib/auth/store";
import {
  confirmEnrollment,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startEnrollment,
  twoFactorStatus,
} from "@/lib/auth/two-factor";
import { rateLimit } from "@/lib/rate-limit";

// /api/account/two-factor — the signed-in account's own two-step verification
// (lib/auth/two-factor.ts).
//
//   GET                               {enabled, locked, recoveryLeft, enabledAt}
//   POST {action: "start", code?}     a new QR (pending until confirmed); with
//                                     2FA already on, a current code or
//                                     recovery code first (new phone)
//   POST {action: "confirm", code}    turn on / switch to the new QR; answers
//                                     new recovery codes, shown once
//   POST {action: "recovery", code}   eight new recovery codes
//   POST {action: "disable", code}    turn it off
//
// Every code is rate limited per account: five per five minutes.

async function account(request: NextRequest): Promise<{ email: string; token: string } | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = await getSessionAccountEmail(token);
  return email && token ? { email, token } : null;
}

const WRONG = "That code is not right, or it was already used.";

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const session = await account(request);
  if (!session) return apiError("unauthorized");
  return NextResponse.json(await twoFactorStatus(session.email), { headers: { "cache-control": "no-store" } });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const session = await account(request);
  if (!session) return apiError("unauthorized");
  const body = (await request.json().catch(() => null)) as { action?: unknown; code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 20) : "";
  const action = body?.action;
  if (action !== "start" && action !== "confirm" && action !== "recovery" && action !== "disable") {
    return apiError("invalid_field", { field: "action" });
  }
  if (code && !(await rateLimit("account-2fa", `account:${session.email}`, { max: 5, windowMs: 5 * 60_000 })).allowed) {
    return apiError("rate_limited");
  }

  if (action === "start") {
    const started = await startEnrollment(session.email, { currentCode: code || undefined });
    if (!started.ok) {
      if (started.reason === "code_required") return apiError("missing_field", { field: "code" });
      return apiError("invalid_field", { field: "code", message: WRONG });
    }
    const qr = await QRCode.toString(started.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json({ secret: started.secret, qr }, { headers: { "cache-control": "no-store" } });
  }

  if (!code) return apiError("missing_field", { field: "code" });

  if (action === "confirm") {
    const result = await confirmEnrollment(session.email, code, session.token);
    if (!result.ok) {
      return apiError("invalid_field", { field: "code", message: result.reason === "wrong_code" ? WRONG : "The setup expired. Start again." });
    }
    return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }, { headers: { "cache-control": "no-store" } });
  }

  const result = action === "recovery" ? await regenerateRecoveryCodes(session.email, code) : await disableTwoFactor(session.email, code);
  if (!result.ok) return apiError("invalid_field", { field: "code", message: WRONG });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
});
