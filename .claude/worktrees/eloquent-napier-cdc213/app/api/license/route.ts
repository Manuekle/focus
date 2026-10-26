import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCurrentLicenseInfo, saveLicenseToken } from "@/lib/license/store";
import { getInstallationId } from "@/lib/license/installation";

// GET /api/license — current Enterprise license status, verified offline,
// plus this machine's installation id (needed even with no license yet —
// it's what the customer sends Oruka to request one bound to this install).
// POST /api/license — saves a pasted license token, after verifying it.
//
// A license here only ever informs the Settings UI. Nothing in this route,
// or anywhere it's called from, refuses a request because the license is
// missing, expired, unverifiable, or bound to a different installation —
// see lib/license/verify.ts.

export const GET = withApiErrors(async function GET() {
  const [info, installationId] = await Promise.all([getCurrentLicenseInfo(), getInstallationId()]);
  return NextResponse.json({ ...info, installationId });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { licenseKey?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const licenseKey = body.licenseKey;
  if (typeof licenseKey !== "string" || licenseKey.trim().length === 0) {
    return apiError("missing_field", { field: "licenseKey" });
  }

  const result = await saveLicenseToken(licenseKey);
  if (!result.ok) {
    return apiError("invalid_field", {
      field: "licenseKey",
      message: "That license token's signature doesn't verify.",
    });
  }

  return NextResponse.json({ ok: true, info: result.info });
});
