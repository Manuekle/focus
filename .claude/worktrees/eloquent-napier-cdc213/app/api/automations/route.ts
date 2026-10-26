import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
} from "@/lib/business-store";
import type {
  Automation,
  AutomationStatus,
  AutomationTrigger,
  ChannelId,
  WorkflowStep,
} from "@/lib/types";
import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { parseStoredSteps } from "@/lib/workflow-schema";
import { countAutomationBlanks } from "@/lib/automation-templates";
import { parseAutomationIntents } from "@/lib/automation-engine";

/**
 * A webhook automation's `triggerValue` is its shared secret, and the route
 * that runs it refuses to fire without one — see
 * app/api/automations/[id]/webhook/route.ts. Generating it here means the
 * operator never has to think about it: the token is simply there, shown next
 * to the automation, ready to paste into whatever calls it.
 *
 * `inherited` is the guard against the way this used to leak. The dialog keeps
 * one `triggerValue` box for every trigger type, so switching a keyword
 * automation to Webhook re-submitted the keyword as the token — and a keyword
 * is the opposite of a secret: it is the word the business prints in its ads
 * and tells customers to send. Anyone who knew it could POST the public
 * webhook and make the account send WhatsApp messages, emails and payment
 * links. A value that is only the previous trigger's value is therefore
 * treated as no value at all, and a real token is minted instead.
 */
function webhookToken(
  trigger: string | undefined,
  value: string | undefined,
  inherited = false,
): string | undefined {
  if (trigger !== "webhook") return undefined;
  const current = inherited ? "" : value?.trim();
  return current || randomBytes(24).toString("hex");
}

const TRIGGERS: readonly AutomationTrigger[] = [
  "keyword",
  "schedule",
  "new_chat",
  "no_reply",
  "webhook",
  "intent",
];

const CHANNELS: ReadonlyArray<ChannelId | "all"> = ["all", "web", "whatsapp", "instagram"];

function isTrigger(value: unknown): value is AutomationTrigger {
  return typeof value === "string" && TRIGGERS.includes(value as AutomationTrigger);
}

function isChannel(value: unknown): value is ChannelId | "all" {
  return typeof value === "string" && CHANNELS.includes(value as ChannelId | "all");
}

/** The fields a screen can actually change. Spreading the request body into
 *  the stored record — which is what this route used to do — let a caller
 *  rewrite `createdAt`, reset `responseCount`, backdate `lastTriggeredAt`, or
 *  park arbitrary keys on an automation that every later read then carries. */
const EDITABLE = [
  "name",
  "description",
  "trigger",
  "triggerValue",
  "channel",
  "status",
  "agentId",
  "steps",
] as const;

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));

  const all = await listAutomations();
  const total = all.length;
  const start = (page - 1) * limit;
  const automations = all.slice(start, start + limit);

  // What each automation last actually did, beside the count of how often it
  // fired. A number that goes up cannot tell a flow that ran to the end from
  // one that stopped at its second step, and both used to read identically.
  const runs = await listAutomationRuns();
  const lastRuns: Record<string, unknown> = {};
  for (const run of runs) {
    const current = lastRuns[run.automationId] as { at?: string } | undefined;
    if (current && Date.parse(current.at ?? "") >= Date.parse(run.createdAt)) continue;
    lastRuns[run.automationId] = {
      id: run.id,
      status: run.status,
      step: Math.min(run.cursor, run.steps.length),
      totalSteps: run.steps.length,
      ...(run.resumeAt ? { resumeAt: run.resumeAt } : {}),
      ...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
      at: run.updatedAt,
    };
  }

  return NextResponse.json({ automations, total, page, limit, lastRuns });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as Partial<Automation>;
  if (!input.name || typeof input.name !== "string") {
    return missingField("name");
  }
  if (input.trigger !== undefined && !isTrigger(input.trigger)) {
    return apiError("invalid_field", { field: "trigger" });
  }
  if (input.channel !== undefined && !isChannel(input.channel)) {
    return apiError("invalid_field", { field: "channel" });
  }
  const trigger = input.trigger ?? "keyword";
  const requested = typeof input.triggerValue === "string" ? input.triggerValue : "";
  if (trigger === "intent" && !parseAutomationIntents(requested)) {
    return apiError("invalid_field", { field: "triggerValue" });
  }

  // Steps are read on every turn of every conversation (formatPlaybook) and
  // executed on every webhook fire, so an unvalidated one is not inert: an
  // unknown type reaches the runner as a silent skip, and stray keys stay on
  // the record forever. Absent means "no steps"; malformed is a 400.
  const steps = input.steps === undefined ? [] : parseStoredSteps(input.steps);
  if (!steps) return apiError("invalid_field", { field: "steps" });

  const automations = await createAutomation({
    name: input.name.trim(),
    description: typeof input.description === "string" ? input.description : "",
    trigger,
    triggerValue: webhookToken(trigger, requested) ?? requested,
    channel: (input.channel as ChannelId | "all") ?? "all",
    ...(typeof input.agentId === "string" ? { agentId: input.agentId } : {}),
    steps,
  });
  return NextResponse.json({ automations });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
    return missingField("id");
  }
  const input = body as Record<string, unknown>;
  const id = input.id as string;
  const updates: Partial<Omit<Automation, "id">> = {};
  for (const key of EDITABLE) {
    if (input[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = input[key];
    }
  }
  if (input.steps !== undefined) {
    const steps = parseStoredSteps(input.steps);
    if (!steps) return apiError("invalid_field", { field: "steps" });
    (updates as { steps?: WorkflowStep[] }).steps = steps;
  }
  if (updates.status !== undefined && !isStatus(String(updates.status))) {
    return apiError("invalid_field", { field: "status" });
  }
  if (updates.trigger !== undefined && !isTrigger(updates.trigger)) {
    return apiError("invalid_field", { field: "trigger" });
  }
  if (updates.channel !== undefined && !isChannel(updates.channel)) {
    return apiError("invalid_field", { field: "channel" });
  }
  // Switching an automation to the webhook trigger, or saving one that never
  // had a token, mints one now rather than leaving a webhook that 401s. The
  // effective trigger can come from either side, so the stored one is read
  // before deciding.
  const existing = (await listAutomations()).find((a) => a.id === id);
  // A template's blanks are text, so nothing else stops them: switched on,
  // the flow would send "[completar]" to a customer or post to a Slack URL
  // that is not one. Whichever steps it will run with are the ones checked.
  if (updates.status === "active" && countAutomationBlanks(updates.steps ?? existing?.steps) > 0) {
    return apiError("automation_has_blanks", { field: "steps" });
  }
  const nextTrigger = updates.trigger ?? existing?.trigger;
  const nextValue = updates.triggerValue ?? existing?.triggerValue;
  if (nextTrigger === "intent" && !parseAutomationIntents(nextValue ?? "")) {
    return apiError("invalid_field", { field: "triggerValue" });
  }
  // "Inherited" means: this automation was not a webhook one, and the value
  // arriving with it is the one it already had — i.e. the previous trigger's
  // keyword, cron line or wait time, echoed back by the dialog rather than
  // typed as a secret.
  const inherited =
    nextTrigger === "webhook" &&
    existing !== undefined &&
    existing.trigger !== "webhook" &&
    nextValue === existing.triggerValue;
  const token = webhookToken(nextTrigger, nextValue, inherited);
  if (token) (updates as { triggerValue?: string }).triggerValue = token;
  const automations = await updateAutomation(id, updates);
  return NextResponse.json({ automations });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return missingField("id");
  const automations = await deleteAutomation(id);
  return NextResponse.json({ automations });
});

function isStatus(value: string): value is AutomationStatus {
  return value === "active" || value === "paused" || value === "draft";
}
