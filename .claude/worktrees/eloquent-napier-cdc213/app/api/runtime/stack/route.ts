import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { checkAgentStack } from "@/lib/agent-stack";

// Agent Stack, AI SDK, AI Gateway, Sandbox, Workflows, Connect — installed and
// configured, or not. See lib/agent-stack.ts for what each check reads and
// why none of them call a provider.
export const GET = withApiErrors(async function GET() {
  return NextResponse.json(await checkAgentStack(), {
    headers: { "cache-control": "no-store" },
  });
});
