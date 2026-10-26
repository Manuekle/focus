import { NextResponse } from "next/server";
import { getMentionableAgents } from "@/lib/chat-agents";
import { withApiErrors } from "@/lib/api-error";

export const GET = withApiErrors(async function GET() {
  const agents = await getMentionableAgents();
  return NextResponse.json({ agents });
});
