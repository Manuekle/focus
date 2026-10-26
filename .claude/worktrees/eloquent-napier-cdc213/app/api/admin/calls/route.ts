import { NextRequest, NextResponse } from "next/server";
import { verifiedOperator } from "@/lib/admin";
import { adminCallsState, parseCallsFilters } from "@/lib/admin-calls";
import { apiError, withApiErrors } from "@/lib/api-error";

export const GET = withApiErrors(async (request: NextRequest) => {
  if (!(await verifiedOperator())) return apiError("not_found");
  const filters = parseCallsFilters(request.nextUrl.searchParams);
  if (!filters) return apiError("invalid_field");
  const result = await adminCallsState(filters);
  return NextResponse.json(result, {
    status: result.state === "not_configured" ? 503 : result.state === "error" ? result.reason === "rate_limit" ? 429 : 502 : 200,
    headers: { "cache-control": "private, no-store" },
  });
});
