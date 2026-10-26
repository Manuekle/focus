import { getAgent, startVoiceCall } from "@/lib/business-store";
import { startOutboundCall } from "@/lib/elevenlabs-agents";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure, missingField, withApiErrors } from "@/lib/api-error";
import { twilioVoiceAccount } from "@/lib/twilio-telephony";

/** E.164: the only format Twilio dials. */
const E164 = /^\+[1-9]\d{7,14}$/;

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!(await getAgent(id))) return apiError("not_found");
  try { return NextResponse.json(await twilioVoiceAccount()); }
  catch (error) { return apiFailure(error, "upstream_failed"); }
});

/**
 * Place a test call from this agent's number to a phone.
 *
 * The call itself runs entirely on ElevenLabs — this endpoint only dials, and
 * returns the conversation id so the transcript can be found afterwards.
 */
export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");
  if (agent.status !== "active") {
    return apiError("conflict", { message: "Only an active agent can place calls." });
  }

  const mirrorId = agent.voice?.elevenlabsAgentId;
  const phoneNumberId = agent.voice?.phoneNumberId;
  if (!agent.voice?.enabled || !mirrorId) {
    return apiError("conflict", {
      message: "This agent has no voice yet — enable and sync it first.",
    });
  }
  if (!phoneNumberId) {
    return apiError("conflict", {
      message: "This agent has no phone number assigned.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const toNumber = (body as { toNumber?: unknown } | null)?.toNumber;
  if (typeof toNumber !== "string" || !toNumber.trim()) return missingField("toNumber");
  const normalizedNumber = toNumber.trim().replace(/[\s().-]/g, "");
  if (!E164.test(normalizedNumber)) {
    return apiError("invalid_field", {
      field: "toNumber",
      message: "The number must be in E.164 format, e.g. +541155550000.",
    });
  }

  try {
    const account = await twilioVoiceAccount();
    if (account.state === "trial") return apiError("twilio_trial_audio");
    if (account.state === "inactive") return apiError("twilio_account_inactive");
    const result = await startOutboundCall({
      elevenlabsAgentId: mirrorId,
      phoneNumberId,
      toNumber: normalizedNumber,
      // On "auto" the destination's country picks the language for this call.
      ...(agent.voice?.language ? { configuredLanguage: agent.voice.language } : {}),
    });
    // Tags the conversation "test" before the post_call_transcription
    // webhook can arrive — see lib/business-store.ts's startVoiceCall.
    if (result.conversationId) {
      await startVoiceCall({ agentId: id, conversationId: result.conversationId, source: "test" });
    }
    return NextResponse.json(result);
  } catch (error) {
    // Twilio's two standard refusals reach here as raw upstream text, and
    // both are fixed in the Twilio console rather than in this app — so the
    // message says where to go. Same treatment the ElevenLabs permission
    // errors get in app/api/elevenlabs/phone-numbers/route.ts.
    const detail = error instanceof Error ? error.message : String(error);
    if (/not authorized to call|geo-permissions|geo permissions/i.test(detail)) {
      return apiError("twilio_geo_blocked", { detail });
    }
    if (/unverified|not verified|trial account/i.test(detail)) {
      return apiError("twilio_trial_unverified", { detail });
    }
    return apiFailure(error, "upstream_failed");
  }
});
