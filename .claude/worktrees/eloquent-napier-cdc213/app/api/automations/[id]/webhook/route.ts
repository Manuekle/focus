import { startRun, webhookFireKey } from "@/lib/automation-run";
import { toMessagingChannel } from "@/lib/contact-channel";
import {
  ingestLead,
  getAutomationRunByFireKey,
  listAutomations,
  recordAutomationFire,
  upsertChat,
} from "@/lib/business-store";
import { triageInbound } from "@/lib/triage";
import { markLeadTriage } from "@/lib/triage-lead";
import type { LeadInput } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { listBusinesses } from "@/lib/business-scope";
import { withWorkspace } from "@/lib/workspace-context";
import type { Automation } from "@/lib/types";

/** Constant-time-ish comparison, so a wrong token can't be probed byte by byte. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Inbound webhook for one automation: an external system POSTs a lead payload
 * and the automation's deterministic steps run immediately. See
 * lib/automation-runner.ts for what "deterministic" covers.
 */
export const POST = withApiErrors(async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  // The budget comes first: the id lookup below is an existence oracle (an
  // unknown id and a known id with a bad secret answer differently), and a
  // caller with neither the id nor the token should not get to enumerate
  // either. Same bucket as /api/leads — one leaked webhook URL is one
  // address's worth of traffic.
  if (!(await rateLimit("public-webhook", request, { max: 30, windowMs: 10 * 60_000 })).allowed) {
    return apiError("rate_limited");
  }

  // A sender that retries on timeout can fire the automation twice — and the
  // steps message people. Require a stable event key instead of accepting a
  // keyless delivery that cannot be distinguished from its own retry.
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) return missingField("Idempotency-Key");
  if (idempotencyKey.length > 200 || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    return apiError("invalid_field", { field: "Idempotency-Key" });
  }

  // The secret check moves ahead of the lookup: with the token verified
  // first, every unauthorised caller gets the same answer whether or not the
  // id exists, so the response cannot be used to enumerate automation ids.
  // Both "no such automation" and "wrong token" share one message for the
  // same reason.
  const provided = request.headers.get("x-webhook-secret");
  let match: { workspaceId: string; automation: Automation } | undefined;
  if (provided) {
    // This is a public URL with no browser workspace cookie. Locate its
    // automation by ID and secret across workspaces, then pin all writes to
    // that workspace. The last browser selection must not redirect a lead.
    const businesses = (await listBusinesses()).businesses.filter((item) => item.access !== "suspended");
    for (const business of businesses) {
      const automation = (await withWorkspace(business.id, () => listAutomations()))
        .find((item) => item.id === id && item.trigger === "webhook");
      const token = automation?.triggerValue?.trim();
      if (automation && token && secretsMatch(provided, token)) {
        match = { workspaceId: business.id, automation };
        break;
      }
    }
  }
  if (!match) {
    return apiError("unauthorized", {
      message:
        "Send this automation's webhook token as the x-webhook-secret header. If the automation has no token yet, re-save it in Automations to have one generated.",
    });
  }
  const { automation } = match;
  if (automation.status !== "active") {
    return apiError("conflict", { message: "This automation is not active." });
  }

  return withWorkspace(match.workspaceId, async () => {

  const fireKey = webhookFireKey(automation.id, idempotencyKey);
  // A known retry must not rewrite the lead or re-run triage. The insert in
  // startRun remains the authoritative atomic guard when workers race here.
  if (await getAutomationRunByFireKey(fireKey)) {
    return NextResponse.json({ ok: true, replayed: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }

  const input = body as LeadInput;
  const lead: LeadInput = {
    ...input,
    source: input.source ?? `webhook:${automation.name}`,
    channel: input.channel ?? (automation.channel === "all" ? "web" : automation.channel),
  };

  // Triage runs concurrently with the write, exactly as it does in
  // `intakeLead`: this is the other door a lead arrives through, and until now
  // it was the one with no judgment on it at all — a lead an integration
  // pushed landed with none of the marks the same lead gets through
  // /api/leads, so the inbox sorted it below the noise and nothing ever raised
  // a hand for it.
  //
  // The marks only. `drop` is deliberately ignored here: the caller
  // authenticated with this automation's own token and asked for these steps
  // by name, and going quiet on a deliberate request is not triage's call to
  // make. Latency is the ingest's, not the sum of both.
  const [ingested, triage] = await Promise.all([
    ingestLead(lead),
    triageInbound({
      message: lead.message ?? "",
      channel: toMessagingChannel(lead.channel ?? "web"),
      contactName: lead.name,
      source: lead.source,
    }),
  ]);
  const contact = await markLeadTriage(ingested, triage);

  const channel = toMessagingChannel(contact.channel);
  await upsertChat({
    title: contact.name,
    channel,
    lastMessage: input.message ?? "Webhook",
    lastMessageAt: contact.lastMessageAt,
    messageCount: input.message ? 1 : 0,
  });

  const { run, created } = await startRun({
    automation,
    contact,
    fireKey,
  });
  // A replay is not a firing. The bare answer is deliberate: nothing from the
  // first run is echoed to a caller who may not be the one that sent it.
  if (!created) return NextResponse.json({ ok: true, replayed: true });

  await recordAutomationFire(automation.id);

  return NextResponse.json({
    ok: true,
    automation: automation.id,
    contact,
    run: run.id,
    status: run.status,
    // Named `results` still: the shape senders already parse.
    results: run.outcomes.map((outcome) => ({
      type: outcome.type,
      status: outcome.status,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    })),
    ...(run.resumeAt ? { resumesAt: run.resumeAt } : {}),
  });
  });
});

// Same reasoning as /api/leads: this URL is pasted into third-party dashboards
// and opened by hand, so a GET should explain itself rather than 405 blankly.
export const GET = withApiErrors(function GET() {
  return apiError("method_not_allowed", {
    message: "This automation webhook only accepts POST.",
  });
});
