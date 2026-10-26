import { type NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { apiError, withApiErrors } from "@/lib/api-error";
import { adminAccess } from "@/lib/admin";
import { confirmEnrollment, startEnrollment, verifyTwoFactor } from "@/lib/auth/two-factor";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/admin/2fa — the operator panel's second-factor step. The factor is
// the account's own two-step verification (lib/auth/two-factor.ts): the same
// QR and codes sign the operator in anywhere on this install.
//
//   {action: "start"}            2FA off: a new secret as a QR code (SVG) and
//                                as text, pending until confirmed
//   {action: "confirm", code}    turn it on with a code from the app; answers
//                                the recovery codes, shown this once
//   {action: "verify", code}     open the panel for this session (12 hours)
//                                with a code or a recovery code
//
// 404 for anyone who is not a signed-in operator on the vendor install. Codes
// are rate limited per operator: five tries per five minutes.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const access = await adminAccess();
  if (access.state !== "needs_2fa") return access.state === "granted" ? apiError("conflict", { message: "Already verified." }) : apiError("not_found");
  const body = (await request.json().catch(() => null)) as { action?: unknown; code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 20) : "";

  if (body?.action === "start") {
    if (access.status.enabled) return apiError("conflict", { message: "Two-step verification is already on." });
    const started = await startEnrollment(access.operator);
    if (!started.ok) return apiError("conflict", { message: "Two-step verification is already on." });
    const qr = await QRCode.toString(started.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json({ secret: started.secret, uri: started.uri, qr }, { headers: { "cache-control": "no-store" } });
  }

  if (body?.action !== "confirm" && body?.action !== "verify") return apiError("invalid_field", { field: "action" });
  if (!(await rateLimit("admin-2fa", `operator:${access.operator}`, { max: 5, windowMs: 5 * 60_000 })).allowed) {
    return apiError("rate_limited", { message: "Too many codes. Wait five minutes." });
  }

  if (body.action === "confirm") {
    const result = await confirmEnrollment(access.operator, code, access.sessionToken);
    if (!result.ok) {
      return apiError("invalid_field", {
        field: "code",
        message: result.reason === "wrong_code" ? "That code is not right." : "The setup expired. Start again.",
      });
    }
    return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }, { headers: { "cache-control": "no-store" } });
  }

  const result = await verifyTwoFactor(access.operator, code, access.sessionToken);
  if (!result.ok) {
    if (result.reason === "locked") return apiError("conflict", { message: "The stored secret cannot be read with this server's key." });
    return apiError("invalid_field", { field: "code", message: "That code is not right, or it was already used." });
  }
  return NextResponse.json({ ok: true, usedRecovery: result.usedRecovery, recoveryLeft: result.recoveryLeft });
});
