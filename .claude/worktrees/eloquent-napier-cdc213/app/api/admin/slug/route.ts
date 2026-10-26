import { type NextRequest, NextResponse } from "next/server";
import { FleetAdminError, fleetAdmin, verifiedOperator } from "@/lib/admin";
import type { AdminSlugCheck } from "@/lib/admin-types";
import { apiError, withApiErrors } from "@/lib/api-error";

// GET /api/admin/slug?slug=acme — whether a slug may name a new installation:
// the provisioner's rules and the registry, asked of the fleet (adminSlugCheck)
// while the operator types it in a request's admission form.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  const slug = (request.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase().slice(0, 63);
  try {
    const check = await fleetAdmin<AdminSlugCheck>(`slug?slug=${encodeURIComponent(slug)}`);
    return NextResponse.json(check, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof FleetAdminError)) throw error;
    if (error.status === null || error.status === 503) return apiError("not_configured", { status: 503, message: error.message });
    if (error.status === 404) return apiError("upstream_failed", { message: "El fleet todavía no admite solicitudes: publica su versión nueva." });
    return apiError("upstream_failed", { message: error.message });
  }
});
