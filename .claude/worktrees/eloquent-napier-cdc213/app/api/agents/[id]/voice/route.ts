import { requireOwner } from "@/lib/owner-gate";
import { getAgent, updateAgent } from "@/lib/business-store";
import {
  ELEVENLABS_SCOPES,
  deleteVoiceAgent,
  hasVoicePlatform,
  syncVoiceAgent,
  assignNumberToAgent,
  listPhoneNumbers,
} from "@/lib/elevenlabs-agents";
import type { AgentVoice } from "@/lib/types";
import { getNumberByE164, unassignNumbersForAgent } from "@/lib/number-store";
import { transferPhone } from "@/lib/voice-handoff";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure, withApiErrors } from "@/lib/api-error";

// The voice half of one agent.
//
// PUT saves the configuration and pushes it to the mirror agent on ElevenLabs
// in the same request, because a saved-but-unsynced state is invisible in the
// UI and only shows up as "the call used the old prompt".
//
// DELETE turns voice off and removes the mirror, so switching voice off in
// this app does not leave an agent running on the ElevenLabs account.

export const PUT = withApiErrors(async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");
  if (agent.status !== "active") {
    return apiError("conflict", { message: "Activate this agent before enabling voice." });
  }

  if (!(await hasVoicePlatform())) {
    return apiError("not_configured", {
      message: "Add an ElevenLabs API key in Settings before enabling voice.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_body");

  const input = body as Partial<AgentVoice>;
  if (input.phoneNumberId !== undefined) {
    const denied = await requireOwner(request);
    if (denied) return denied;
    if (typeof input.phoneNumberId !== "string" || !input.phoneNumberId) return apiError("invalid_body");
    const line = (await listPhoneNumbers()).find((n) => n.phoneNumberId === input.phoneNumberId);
    if (!line) return apiError("not_found");
    if (line.assignedAgentId && line.assignedAgentId !== agent.voice?.elevenlabsAgentId) return apiError("conflict");
  }
  let destination: string | undefined;
  try {
    destination = transferPhone(Object.hasOwn(input, "transferPhoneNumber") ? input.transferPhoneNumber : agent.voice?.transferPhoneNumber);
  } catch {
    return apiError("invalid_body", { field: "transferPhoneNumber" });
  }
  if (destination && (await getNumberByE164(destination))?.agentId) {
    return apiError("invalid_body", { field: "transferPhoneNumber", message: "Choose a human phone number, not a number answered by an agent." });
  }
  const voice: AgentVoice = {
    ...agent.voice,
    // Cleared on every save: syncVoiceAgent sets it again if the problem is
    // still there, and a stale warning is worse than none.
    toolsWarning: undefined,
    enabled: input.enabled ?? agent.voice?.enabled ?? true,
    voiceId: input.voiceId ?? agent.voice?.voiceId,
    firstMessage: input.firstMessage ?? agent.voice?.firstMessage,
    language: input.language ?? agent.voice?.language,
    phoneNumberId: input.phoneNumberId ?? agent.voice?.phoneNumberId,
    transferPhoneNumber: destination,
  };

  try {
    const synced = await syncVoiceAgent(agent, voice);
    // Routing the number is a separate call, and only matters once the mirror
    // exists — an unassigned number rings nobody.
    if (synced.phoneNumberId && synced.elevenlabsAgentId) {
      await assignNumberToAgent(synced.phoneNumberId, synced.elevenlabsAgentId);
    }
    const updated = await updateAgent(id, { voice: synced });
    return NextResponse.json({ ok: true, agent: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const perm = msg.match(/permission (\w+)/)?.[1];
    if (perm || msg.includes("missing_permissions") || msg.includes("unauthorized")) {
      return apiError("elevenlabs_permission", { detail: msg, field: perm ?? ELEVENLABS_SCOPES });
    }
    return apiFailure(error, "upstream_failed");
  }
});

export const DELETE = withApiErrors(async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");

  const mirrorId = agent.voice?.elevenlabsAgentId;
  if (mirrorId) {
    try {
      await deleteVoiceAgent(mirrorId, agent.voice?.toolIds);
    } catch (error) {
      // A mirror deleted from the ElevenLabs dashboard is already in the state
      // this call wants, so the local record is cleared either way rather than
      // leaving the agent stuck with an id that resolves to nothing.
      console.warn(`[voice] could not delete mirror agent ${mirrorId}:`, error);
    }
  }

  // toolIds cleared with the mirror: keeping them would make the next sync
  // try to update tools that no longer exist.
  if (agent.voice?.phoneNumberId) await unassignNumbersForAgent(id, agent.voice.phoneNumberId);
  const updated = await updateAgent(id, { voice: { enabled: false } });
  return NextResponse.json({ ok: true, agent: updated });
});
