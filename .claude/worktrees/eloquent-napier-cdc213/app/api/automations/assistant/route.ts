import { generateObject } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveTaskModel } from "@/lib/task-model";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { getProviderReport } from "@/lib/provider-catalog";
import { storedWorkflowStepSchema, workflowAssistantResponseSchema } from "@/lib/workflow-schema";
import { STEP_TYPES } from "@/lib/workflow-step-meta";
import type { WorkflowStep } from "@/lib/types";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { guardAiRoute, recordRouteUsage } from "@/lib/ai-route-guard";
import { aiGenerationFailure } from "@/lib/ai-generation-error";

// POST /api/automations/assistant
// Turns a plain-language request into a proposed workflow. It only ever
// RETURNS a plan — it never writes to the store. The canvas applies it once
// the user accepts, so a person is always the one who approves the change.
export const maxDuration = 90;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  steps: z.array(storedWorkflowStepSchema).default([]),
  name: z.string().optional(),
  trigger: z.string().optional(),
  triggerValue: z.string().optional(),
  channel: z.string().optional(),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(24).default([]),
});
function describeExistingSteps(steps: readonly WorkflowStep[]): string {
  if (steps.length === 0) return "(empty — the flow has no steps yet)";
  const lines: string[] = [];
  const walk = (list: readonly WorkflowStep[], indent: string) => {
    list.forEach((step, i) => {
      const config = Object.entries(step.config)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(`${indent}${i + 1}. ${step.type}${config ? ` (${config})` : ""}`);
      if (step.thenSteps?.length) {
        lines.push(`${indent}   if true:`);
        walk(step.thenSteps, `${indent}     `);
      }
      if (step.elseSteps?.length) {
        lines.push(`${indent}   if false:`);
        walk(step.elseSteps, `${indent}     `);
      }
    });
  };
  walk(steps, "");
  return lines.join("\n");
}

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const refused = await guardAiRoute(request, "automations-assistant", undefined, "automation");
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }

  if (!(body as { prompt?: unknown }).prompt) return missingField("prompt");
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid_field", { field: String(parsed.error.issues[0]?.path[0] ?? "prompt") });
  const input = parsed.data;
  const prompt = input.prompt;

  const { modelId, provider } = await resolveTaskModel("automation", undefined, request);
  const health = await getProviderReport(provider);
  if (health.status === "missing" || health.status === "invalid") {
    return apiError("no_credentials");
  }

  const existing = Array.isArray(input.steps) ? input.steps : [];

  const system = [
    "You design conversational automation flows for a business messaging agent.",
    "Talk to the owner about their flow. For greetings (such as 'hola'), questions,",
    "or unclear requests, return a short reply and plan: null. Ask what they want",
    "to automate when they only greet you. Never rewrite a flow just to answer a greeting.",
    "Only propose a plan when the user requests a concrete creation or change.",
    "When proposing, return the COMPLETE flow after applying the request — not just the new part.",
    "When the user asks for a tweak, preserve the steps they did not mention.",
    "The current canvas below is authoritative. Earlier proposals are not applied unless reflected there.",
    "",
    `Step types you may use: ${STEP_TYPES.join(", ")}.`,
    "- message: send a fixed text you write.",
    "- ai_response: let the agent compose a reply; `prompt` guides it.",
    "- wait: pause; `duration` like '30min', '2h', '1d'.",
    "- condition: branch. Put the follow-up steps in thenSteps / elseSteps.",
    "- transfer_human: hand the conversation to a person.",
    "- send_audio / send_image / send_video: send media. Use `mediaPrompt` to",
    "  describe what to generate when the user has not given a URL.",
    "- notify_whatsapp: WhatsApp a fixed number (the team, sales, on-call).",
    "  Set `phone` in E.164 and `message`. Not for replying to the contact —",
    "  use `message` for that.",
    "- notify_team: post to a Slack or Discord channel via an incoming",
    "  webhook. Set `service` (slack | discord), `webhookUrl`, and `message`.",
    "- notify_email: email someone. Set `emailTo`, `emailSubject` and either",
    "  `message` for a plain-text body or `emailTemplate` for a saved template.",
    "- book_meeting: book the next free slot on the connected Google Calendar",
    "  and send the contact the Meet link. Set `meetingDurationMin` and",
    "  `meetingSummary`; `message` may use {{start}} and {{meetLink}}. Only",
    "  runs on webhook-triggered flows.",
    "- log_sheet: append the contact's info to a Google Sheet. Set",
    "  `spreadsheetId` and `sheetName`. Only runs on webhook-triggered flows.",
    "- send_payment_link: create a checkout link and send it to the contact.",
    "  Set `amount` (decimal), `currency` (ISO code), `productName`, and",
    "  optionally `message` with a {{link}} placeholder. `paymentProvider` is",
    "  'stripe' or 'mercadopago' — pick mercadopago for ARS, BRL, CLP, COP,",
    "  MXN, PEN or UYU, stripe otherwise, and omit it when unsure. Only runs",
    "  on webhook-triggered flows.",
    "- http_request: call an external HTTPS API or webhook. Set `url`, `method`",
    "  and a JSON `body`. Placeholders like {{contact.name}}, {{contact.phone}}",
    "  and {{contact.email}} are substituted at run time.",
    "- update_contact: write back to the CRM. `contactStatus` is one of open,",
    "  waiting_human, followup_due, closed; `contactNote` appends a note.",
    "",
    "Write all user-facing copy (message text, prompts, conditions) in the same",
    "language the user wrote to you in. Keep messages short and natural for",
    "WhatsApp/Instagram — not corporate boilerplate.",
    "Prefer the fewest steps that genuinely do the job.",
  ].join("\n");

  const context = [
    `Automation name: ${input.name || "(unnamed)"}`,
    `Trigger: ${input.trigger ?? "keyword"}${input.triggerValue ? ` = ${input.triggerValue}` : ""}`,
    `Channel: ${input.channel ?? "all"}`,
    "",
    "Current flow:",
    describeExistingSteps(existing),
    "",
    "Conversation so far:",
    ...input.turns.map(turn => `${turn.role === "user" ? "Owner" : "Assistant"}: ${turn.text}`),
    "",
    `User request: ${prompt}`,
  ].join("\n");

  try {
    const result = await generateObject({
      model: resolveLanguageModel(modelId, provider),
      schema: workflowAssistantResponseSchema,
      system,
      prompt: context,
      abortSignal: AbortSignal.timeout(60_000),
    });
    await recordRouteUsage({ model: modelId, provider, usage: result.usage, providerMetadata: result.providerMetadata, conversationId: "automations-assistant" });
    return NextResponse.json(result.object);
  } catch (error) {
    return aiGenerationFailure(error, "automations-assistant");
  }
});
