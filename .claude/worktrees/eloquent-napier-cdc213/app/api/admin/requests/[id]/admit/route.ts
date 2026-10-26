import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FleetAdminError, fleetAdmin, verifiedOperator } from "@/lib/admin";
import type { AdminAdmitResult } from "@/lib/admin-types";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getAccessRequest, recordAdmission } from "@/lib/access-requests";

// POST /api/admin/requests/<id>/admit {slug, plan, email, revision} — admits
// a beta request: the fleet creates the installation (oruka-fleet
// adminAdmit), its provisioning job builds it and invites the owner at the
// last step, and the request records which tenant it became.
//
// Safe to retry: the fleet admits a request id once and answers the same
// tenant again, so a failure between the fleet and this store is fixed by
// pressing the button again. `revision` keeps an operator from admitting a
// request someone else just changed.

const admit = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(63),
  plan: z.enum(["pro", "managed"]),
  email: z.string().trim().toLowerCase().max(320).email(),
  revision: z.number().int().nonnegative(),
}).strict();

const NO_STORE = { "cache-control": "private, no-store" };

export const POST = withApiErrors(async function POST(
  request: NextRequest, { params }: { params: Promise<{ id: string }> },
) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  if (request.headers.get("origin") !== request.nextUrl.origin) return apiError("forbidden");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return apiError("invalid_body");
  const parsed = admit.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return apiError("invalid_field", typeof field === "string" ? { field } : {});
  }
  const { id } = await params;
  if (!/^req_[\w-]{20}$/.test(id)) return apiError("not_found");
  const current = await getAccessRequest(id);
  if (!current) return apiError("not_found");
  const input = parsed.data;
  if (current.admission && current.admission.slug !== input.slug) {
    return apiError("conflict", { field: "slug", message: `Esta solicitud ya fue admitida como ${current.admission.domain}.` });
  }
  if (!current.admission && current.revision !== input.revision) {
    return apiError("conflict", { message: "La solicitud cambió. Actualiza la página antes de admitirla." });
  }

  let result: AdminAdmitResult;
  try {
    result = await fleetAdmin<AdminAdmitResult>("admit", {
      method: "POST",
      body: { requestId: id, slug: input.slug, email: input.email, plan: input.plan },
      actor: operator,
    });
  } catch (error) {
    if (!(error instanceof FleetAdminError)) throw error;
    const field = error.field ?? undefined;
    if (error.status === 400) return apiError("invalid_field", { field, message: error.message });
    if (error.status === 409) return apiError("conflict", { field, message: error.message });
    if (error.status === null || error.status === 503) return apiError("not_configured", { status: 503, message: error.message });
    // A fleet older than admissions answers 404 to the action it lacks.
    if (error.status === 404) return apiError("upstream_failed", { message: "El fleet todavía no admite solicitudes: publica su versión nueva." });
    return apiError("upstream_failed", { message: error.message });
  }

  const recorded = await recordAdmission(id, {
    tenantId: result.tenant.id,
    slug: result.tenant.slug,
    domain: result.tenant.domain,
    plan: result.tenant.plan,
    email: result.tenant.ownerEmail,
    at: new Date().toISOString(),
    actor: operator,
  });
  if (recorded.state === "not_found") return apiError("not_found");
  return NextResponse.json(
    { request: recorded.request, tenant: result.tenant, created: result.created, queued: result.queued },
    { headers: NO_STORE },
  );
});
