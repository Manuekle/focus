import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifiedOperator } from "@/lib/admin";
import { apiError, withApiErrors } from "@/lib/api-error";
import { updateAccessRequest } from "@/lib/access-requests";
import { REQUEST_STATUSES } from "@/lib/access-request-types";

const change = z.object({
  status: z.enum(REQUEST_STATUSES), notes: z.string().trim().max(5000), revision: z.number().int().nonnegative(),
}).strict();

export const POST = withApiErrors(async function POST(
  request: NextRequest, { params }: { params: Promise<{ id: string }> },
) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  if (request.headers.get("origin") !== request.nextUrl.origin) return apiError("forbidden");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return apiError("invalid_body");
  const parsed = change.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body");
  const { id } = await params;
  if (!/^req_[\w-]{20}$/.test(id)) return apiError("not_found");
  const result = await updateAccessRequest(id, parsed.data, operator);
  if (result.state === "not_found") return apiError("not_found");
  if (result.state === "conflict") return apiError("conflict", { message: "La solicitud cambió. Actualiza la página antes de guardar." });
  if (result.state === "invalid_status") {
    return apiError("invalid_field", { field: "status", message: "Una solicitud admitida tiene su instalación: su estado no cambia a mano." });
  }
  return NextResponse.json({ request: result.request }, { headers: { "cache-control": "private, no-store" } });
});
