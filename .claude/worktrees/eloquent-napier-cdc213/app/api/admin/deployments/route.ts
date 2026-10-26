import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { FleetAdminError, fleetAdmin, verifiedOperator } from "@/lib/admin";

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  // This cookie-authenticated operation must originate at this panel.
  if (request.headers.get("origin") !== request.nextUrl.origin) return apiError("forbidden");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return apiError("invalid_body");
  const body = await request.json().catch(() => null) as { action?: unknown; sha?: unknown } | null;
  if (!body || typeof body.action !== "string" || !["deploy", "rollback"].includes(body.action) || typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha)) return apiError("invalid_field");
  try {
    const result = await fleetAdmin<Record<string, unknown>>("release", { method: "POST", body: { action: body.action, sha: body.sha }, actor: operator });
    return NextResponse.json(result, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (!(error instanceof FleetAdminError)) throw error;
    if (error.status === 409) return apiError("conflict", { message: error.message });
    if (error.status === 400) return apiError("invalid_field", { message: error.message });
    if (error.status === 503) return apiError("not_configured", { message: error.message, status: 503 });
    return apiError("upstream_failed", { message: error.message });
  }
});
