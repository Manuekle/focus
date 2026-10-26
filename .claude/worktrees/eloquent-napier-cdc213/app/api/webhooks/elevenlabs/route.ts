import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import {
  normalizeTranscript,
  verifyElevenLabsWebhookSignature,
  type PostCallTranscriptionEvent,
} from "@/lib/elevenlabs-agents";
import { getAgentByElevenLabsAgentId, recordVoiceCallTranscript } from "@/lib/business-store";

// POST /api/webhooks/elevenlabs — ElevenLabs calls this, not a browser.
// Public in middleware.ts, same reasoning as /api/billing/webhook: a webhook
// can't carry a session cookie, so the HMAC signature over the raw body is
// what stands in for auth here.
//
// The only event this app subscribes to (and the only one handled below) is
// post_call_transcription — the one that fires once a call the agent's
// ElevenLabs mirror handled has ended, carrying the full transcript. That
// covers all three ways a call happens: a real inbound call to the routed
// number, the "Llamada de prueba" outbound button, and the in-browser Orb
// call on the voice page — all three are conversations on the same mirror
// agent, so all three land here the same way.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  // Read the raw body before anything touches it — the signature is over
  // these exact bytes, not over a re-serialized JSON.parse/JSON.stringify
  // round trip.
  const rawBody = await request.text();

  const webhookSecret = await getCredential("ELEVENLABS_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return apiError("not_configured", {
      message:
        "ELEVENLABS_WEBHOOK_SECRET is not set — add it in Settings before pointing ElevenLabs at this endpoint.",
    });
  }

  const verified = verifyElevenLabsWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("elevenlabs-signature"),
    webhookSecret,
  });
  if (!verified) {
    return apiError("unauthorized", { message: "Invalid ElevenLabs signature." });
  }

  let event: PostCallTranscriptionEvent;
  try {
    event = JSON.parse(rawBody) as PostCallTranscriptionEvent;
  } catch {
    return apiError("invalid_json");
  }

  // Every other event type this app never asked for (or ElevenLabs adds
  // later) is a 200 so it doesn't get retried forever.
  if (event.type !== "post_call_transcription") {
    return NextResponse.json({ received: true });
  }

  const data = event.data;
  const elevenlabsAgentId = data?.agent_id;
  const conversationId = data?.conversation_id;
  if (!elevenlabsAgentId || !conversationId) {
    return NextResponse.json({ received: true });
  }

  const agent = await getAgentByElevenLabsAgentId(elevenlabsAgentId);
  if (!agent) {
    // A mirror agent this installation no longer knows about (deleted
    // locally after the call was placed) — nothing to attach the transcript
    // to.
    return NextResponse.json({ received: true });
  }

  await recordVoiceCallTranscript({
    agentId: agent.id,
    conversationId,
    transcript: normalizeTranscript(data),
    durationSecs: data?.metadata?.call_duration_secs,
    startedAt: data?.metadata?.start_time_unix_secs
      ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
      : undefined,
  });

  return NextResponse.json({ received: true });
});
