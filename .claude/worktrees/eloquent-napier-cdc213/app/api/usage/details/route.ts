import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getInstallationId } from "@/lib/license/installation";
import { getUsageDetails } from "@/lib/usage-report";

// GET /api/usage/details — the filterable "Usage details" table. Query
// params: since, until (ISO), provider, model, agentId, workspaceId,
// userId, billingSource, limit, offset.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const organizationId = await getInstallationId();
  const params = request.nextUrl.searchParams;

  const limitParam = params.get("limit");
  const offsetParam = params.get("offset");
  const since = params.get("since");
  const until = params.get("until");

  const result = await getUsageDetails(organizationId, {
    since: since ? new Date(since) : undefined,
    until: until ? new Date(until) : undefined,
    provider: params.get("provider") ?? undefined,
    model: params.get("model") ?? undefined,
    agentId: params.get("agentId") ?? undefined,
    workspaceId: params.get("workspaceId") ?? undefined,
    userId: params.get("userId") ?? undefined,
    billingSource: params.get("billingSource") ?? undefined,
    limit: limitParam ? Number(limitParam) : undefined,
    offset: offsetParam ? Number(offsetParam) : undefined,
  });
  return NextResponse.json(result);
});
