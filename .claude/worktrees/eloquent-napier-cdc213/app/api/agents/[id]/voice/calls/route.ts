import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { getAgent, listVoiceCalls, startVoiceCall, updateVoiceCallState } from "@/lib/business-store";
import { getConversation, hasVoicePlatform } from "@/lib/elevenlabs-agents";
import type { VoiceCall } from "@/lib/types";

// GET lists this agent's saved calls (test and real), refreshing the ones
// that have not finished yet by asking ElevenLabs directly.
//
// The post-call webhook (see app/api/webhooks/elevenlabs) is still the path
// that works with nobody watching, but it cannot be the only one: it needs a
// public URL, so on a laptop running `next dev` a transcript never arrives at
// all, and even in production nothing exists to show *while* a call is
// happening. Polling the few unfinished calls closes both — the page already
// re-fetches this route every few seconds, so the live status comes along for
// free.
//
// POST is called from the browser the moment the in-browser Orb call
// connects, to tag that conversation "test" before the webhook can arrive —
// the same reason app/api/agents/[id]/voice/call/route.ts tags the outbound
// "Llamada de prueba" button's call. Without this, a call this app itself
// placed from inside the browser would default to "real" once the webhook
// shows up with no matching pending row.

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");

  const calls = await refreshOpenCalls(id, await listVoiceCalls(id));
  return NextResponse.json({ calls });
});

/** A ceiling on the fan-out, so a page open on an agent with a burst of calls
 *  cannot turn one page refresh into a dozen upstream requests. */
const MAX_REFRESH_PER_REQUEST = 3;

/**
 * Rows still worth asking about: anything without a transcript that has not
 * reached an end state.
 *
 * No time window, on purpose. A successful poll always lands the row on a
 * terminal status or on a genuinely live one, so each row converges after one
 * answer and stops being asked about — and a conversation ElevenLabs no
 * longer has is closed out below rather than retried forever. A window would
 * instead strand every row that was pending when it expired: a transcript
 * sitting upstream that this app would never go and get.
 */
function isOpen(call: VoiceCall): boolean {
  if (call.status === "done" || call.status === "failed") return false;
  return call.transcript.length === 0;
}

/**
 * How long a call may sit in a non-terminal state before it is written off.
 *
 * The one case that never converges on its own: a call Twilio connected but
 * whose media stream never reached ElevenLabs stays `initiated` upstream
 * forever, with no transcript coming. Without this it would be re-polled on
 * every page refresh for the life of the installation.
 */
const STALE_CALL_MS = 2 * 60 * 60 * 1000;

/** ElevenLabs no longer has this conversation, so nothing will ever arrive
 *  for it. Recognised by status code where the SDK exposes one, and by the
 *  message otherwise. */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number; status?: number })?.statusCode ??
    (error as { status?: number })?.status;
  if (status === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /404|not found/i.test(message);
}

/**
 * Best-effort. Every failure here is a refresh that did not happen, never a
 * list that fails to render: the saved calls are the answer, and an
 * ElevenLabs outage (or no API key at all) must not blank the page.
 */
async function refreshOpenCalls(agentId: string, calls: VoiceCall[]): Promise<VoiceCall[]> {
  const open = calls.filter(isOpen).slice(0, MAX_REFRESH_PER_REQUEST);
  if (open.length === 0 || !(await hasVoicePlatform())) return calls;

  const refreshed = new Map<string, VoiceCall>();
  await Promise.all(
    open.map(async (call) => {
      try {
        const state = await getConversation(call.conversationId);
        const stale =
          state.status !== "done" &&
          state.status !== "failed" &&
          Date.now() - new Date(state.startedAt ?? call.startedAt).getTime() > STALE_CALL_MS;
        const updated = await updateVoiceCallState({
          agentId,
          conversationId: call.conversationId,
          status: stale ? "failed" : state.status,
          transcript: state.transcript,
          durationSecs: state.durationSecs,
          startedAt: state.startedAt,
          terminationReason:
            state.terminationReason ??
            (stale ? "The call never connected — no audio ever reached the agent." : undefined),
        });
        refreshed.set(call.conversationId, updated);
      } catch (error) {
        if (!isGone(error)) return; // Transient: leave the row open to retry.
        // Gone upstream: close the row so it stops being polled on every
        // page refresh, and say why the transcript is never coming.
        refreshed.set(
          call.conversationId,
          await updateVoiceCallState({
            agentId,
            conversationId: call.conversationId,
            status: "failed",
            transcript: call.transcript,
            terminationReason: "ElevenLabs no longer has this conversation.",
          }),
        );
      }
    }),
  );

  return refreshed.size === 0
    ? calls
    : calls.map((call) => refreshed.get(call.conversationId) ?? call);
}

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");
  if (agent.status !== "active") {
    return apiError("conflict", { message: "Only an active agent can start a voice session." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const conversationId = (body as { conversationId?: unknown } | null)?.conversationId;
  if (typeof conversationId !== "string" || !conversationId.trim()) {
    return missingField("conversationId");
  }

  const call = await startVoiceCall({ agentId: id, conversationId: conversationId.trim(), source: "test" });
  return NextResponse.json({ call });
});
