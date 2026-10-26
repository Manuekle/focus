import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getInstallationId } from "@/lib/license/installation";
import { getUsageSummary } from "@/lib/usage-report";

// GET /api/usage/summary?since=<iso>&until=<iso> — the breakdown cards on
// Settings → AI Usage: totals, by provider, by agent, by channel.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const organizationId = await getInstallationId();
  const params = request.nextUrl.searchParams;
  const since = params.get("since");
  const until = params.get("until");
  const summary = await getUsageSummary(organizationId, {
    since: since ? new Date(since) : undefined,
    until: until ? new Date(until) : undefined,
  });
  return NextResponse.json(summary);
});
