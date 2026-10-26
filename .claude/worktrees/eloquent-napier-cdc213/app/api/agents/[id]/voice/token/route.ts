import { getAgent } from "@/lib/business-store";
import { getWebrtcToken } from "@/lib/elevenlabs-agents";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure, withApiErrors } from "@/lib/api-error";

/**
 * Mint a WebRTC token so the browser can talk to this agent's mirror.
 *
 * The token is short-lived and scoped to one conversation, which is what lets
 * the playground connect without ever shipping the ElevenLabs API key to the
 * client.
 */
export const POST = withApiErrors(async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");
  if (agent.status !== "active") {
    return apiError("conflict", { message: "Only an active agent can start a voice session." });
  }

  const mirrorId = agent.voice?.elevenlabsAgentId;
  if (!agent.voice?.enabled || !mirrorId) {
    return apiError("conflict", {
      message: "This agent has no voice yet — enable and sync it first.",
    });
  }

  try {
    const token = await getWebrtcToken(mirrorId);
    return NextResponse.json({ token });
  } catch (error) {
    return apiFailure(error, "upstream_failed");
  }
});
