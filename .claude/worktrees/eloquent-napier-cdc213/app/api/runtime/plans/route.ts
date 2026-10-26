import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { listPlans } from "@/lib/runtime-store";

// The checklists agents wrote for themselves, newest first. Written by
// agent/tools/plan.ts as a run progresses; this is the read side the runtime
// page polls so a long turn shows steps instead of a spinner.
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? undefined;
  const plans = await listPlans(sessionId);
  return NextResponse.json(
    { plans: plans.slice(0, 20) },
    { headers: { "cache-control": "no-store" } },
  );
});
