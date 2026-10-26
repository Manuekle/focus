import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { FleetAdminError, verifiedOperator, fleetAdmin } from "@/lib/admin";
import { isFeatureId } from "@/lib/features";

// POST /api/admin/tenants/<id> — the operator panel's changes to one tenant,
// passed to the fleet's admin API (lib/admin.ts) with who asked:
//
//   {action: "plan", plan: "pro" | "managed"}   a beta tenant's plan, pushed now
//   {action: "push-config"}                     re-push its runtime configuration
//   {action: "feature", feature, on}            an app feature on/off for it (lib/features.ts);
//                                               `on: null` goes back to the default
//   {action: "reinvite"}                        reissue the owner's invite (awaiting_owner)
//
// 404 for anyone but a signed-in operator who passed this session's TOTP
// code (lib/auth/two-factor.ts) on the vendor install, the same answer as a route
// that does not exist.

const ACTIONS = new Set(["plan", "push-config", "reinvite", "feature"]);

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown; plan?: unknown; feature?: unknown; on?: unknown } | null;
  const action = typeof body?.action === "string" && ACTIONS.has(body.action) ? body.action : null;
  if (!action) return apiError("invalid_field", { field: "action" });
  // Only features this release knows: the panel lists lib/features.ts, so
  // anything else is a stale tab or a hand-made request.
  if (action === "feature" && (!isFeatureId(body?.feature) || (body?.on !== true && body?.on !== false && body?.on !== null))) {
    return apiError("invalid_field", { field: "feature" });
  }

  try {
    const result = await fleetAdmin<Record<string, unknown>>(action, {
      method: "POST",
      body: {
        id,
        ...(action === "plan" ? { plan: body?.plan } : {}),
        ...(action === "feature" ? { feature: body?.feature, on: body?.on } : {}),
      },
      actor: operator,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof FleetAdminError)) throw error;
    if (error.status === 400) return apiError("invalid_field", { message: error.message });
    if (error.status === 404) return apiError("not_found", { message: error.message });
    if (error.status === 409) return apiError("conflict", { message: error.message });
    if (error.status === null && !process.env.ORUKA_FLEET_ADMIN_TOKEN) return apiError("not_configured");
    return apiError("upstream_failed", { message: error.message });
  }
});
