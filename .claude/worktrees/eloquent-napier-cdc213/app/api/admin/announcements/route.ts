import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { FleetAdminError, verifiedOperator, fleetAdmin } from "@/lib/admin";

// POST /api/admin/announcements — the operator panel's announcement changes,
// passed to the fleet's admin API (lib/admin.ts) with who asked:
//
//   {action: "save", id?, announcement}   create (no id) or rewrite one
//   {action: "status", id, status}        draft | published | archived | delete
//
// The fleet validates the announcement itself and delivers a change to the
// published set at once. 404 for anyone but a signed-in operator who passed
// this session's TOTP code on the vendor install, the same answer as a route
// that does not exist.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; id?: unknown; announcement?: unknown; status?: unknown }
    | null;
  const id = typeof body?.id === "string" ? body.id : undefined;

  let call: { path: string; body: Record<string, unknown> };
  if (body?.action === "save") {
    if (!body.announcement || typeof body.announcement !== "object") return apiError("invalid_field", { field: "announcement" });
    call = { path: "announcement", body: { ...(id ? { id } : {}), announcement: body.announcement } };
  } else if (body?.action === "status") {
    if (!id) return apiError("invalid_field", { field: "id" });
    call = { path: "announcement-status", body: { id, status: body.status } };
  } else {
    return apiError("invalid_field", { field: "action" });
  }

  try {
    return NextResponse.json(await fleetAdmin<Record<string, unknown>>(call.path, { method: "POST", body: call.body, actor: operator }));
  } catch (error) {
    if (!(error instanceof FleetAdminError)) throw error;
    if (error.status === 400) return apiError("invalid_field", { message: error.message });
    if (error.status === 404) return apiError("not_found", { message: error.message });
    if (error.status === 409) return apiError("conflict", { message: error.message });
    if (error.status === null && !process.env.ORUKA_FLEET_ADMIN_TOKEN) return apiError("not_configured");
    return apiError("upstream_failed", { message: error.message });
  }
});
