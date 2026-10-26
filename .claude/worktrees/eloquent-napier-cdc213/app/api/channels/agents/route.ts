import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import {
  AgentAssignmentError,
  getChannelAgents,
  setChannelAgent,
} from "@/lib/business-store";
import type { ChannelId } from "@/lib/types";

// Which agent answers each customer channel.
//
// The assignment is what gives an inbound WhatsApp message an agent at all,
// and therefore what makes that agent's capability list mean anything — see
// lib/agent-scope.ts. A channel with nobody assigned can still converse, but
// action tools fail closed until an active agent is selected.

const CHANNELS: readonly ChannelId[] = ["whatsapp", "instagram"];

function isChannel(value: unknown): value is ChannelId {
  return typeof value === "string" && CHANNELS.includes(value as ChannelId);
}

export const GET = withApiErrors(async function GET() {
  return NextResponse.json({ channels: CHANNELS, assignments: await getChannelAgents() });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = body as { channel?: unknown; agentId?: unknown } | null;
  if (!isChannel(input?.channel)) return missingField("channel");

  // `null` is a real value here — it is how a channel goes back to having no
  // agent — so an absent field is the error, not a falsy one.
  const agentId = input?.agentId;
  if (agentId !== null && typeof agentId !== "string") return missingField("agentId");

  try {
    const assignments = await setChannelAgent(input.channel, agentId);
    return NextResponse.json({ assignments });
  } catch (error) {
    if (error instanceof AgentAssignmentError) {
      return error.reason === "not_found"
        ? apiError("not_found", { message: error.message })
        : apiError("conflict", { message: error.message });
    }
    throw error;
  }
});
