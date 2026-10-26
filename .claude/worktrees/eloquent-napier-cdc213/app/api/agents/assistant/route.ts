import { generateObject } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveTaskModel } from "@/lib/task-model";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { getProviderReport } from "@/lib/provider-catalog";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { guardAiRoute, recordRouteUsage } from "@/lib/ai-route-guard";
import { CAPABILITIES } from "@/lib/agent-capabilities";
import { getBusinessIdentity, getBusinessProfile } from "@/lib/business-profile-store";
import { listDocuments } from "@/lib/knowledge-store";
import { normalizeBrief } from "@/lib/agent-brief";
import type { AgentBrief } from "@/lib/types";
import { aiGenerationFailure } from "@/lib/ai-generation-error";

// POST /api/agents/assistant
//
// The conversational half of the agent builder: the thing that asks the
// questions so the owner does not have to know what a system prompt is.
//
// Three properties separate it from /api/agents/optimize, which it does not
// replace:
//
//   1. It is a conversation, not a one-shot. The browser sends the turns so
//      far plus the draft as it currently stands, and each answer both fills
//      something in and asks the next thing it needs.
//   2. It knows the business. The identity the owner typed in, the generated
//      profile, and how many documents the knowledge base holds are all in
//      the system prompt — so the questions are about *their* business ("¿los
//      turnos se agendan en el Google Calendar que ya conectaste?") instead of
//      generic prompt-engineering trivia.
//   3. It never writes. The answer carries a patch the builder renders as a
//      proposal, and a person applies it. Same rule as the flow assistant.
//
// It writes nothing to the store — the builder's own autosave does that when
// the patch is applied.

/** Turns of context sent back. Long enough to hold an interview, short enough
 *  that a forgotten tab cannot grow into an expensive prompt. */
const MAX_TURNS = 24;

const briefPatchSchema = z.object({
  role: z.string().nullable(),
  goal: z.string().nullable(),
  audience: z.string().nullable(),
  tone: z.string().nullable(),
  language: z.string().nullable(),
  greeting: z.string().nullable(),
  rules: z.array(z.string()).nullable(),
  avoid: z.array(z.string()).nullable(),
  handoff: z.string().nullable(),
});

const answerSchema = z.object({
  reply: z
    .string()
    .describe(
      "Two or three sentences at most, in the user's language: what you understood and what you just filled in.",
    ),
  patch: z
    .object({
      name: z.string().nullable().describe("Agent name, 2-4 words. null when unchanged."),
      description: z.string().nullable().describe("One line describing what the agent does. null when unchanged."),
      brief: briefPatchSchema.nullable(),
      capabilities: z
        .array(z.string())
        .nullable()
        .describe("Capability ids from the catalog. The complete list the agent should end up with."),
    })
    .describe("Only the fields this turn actually decided. Set unchanged fields to null."),
  questions: z
    .array(
      z.object({
        question: z.string().describe("One short question, in the user's language."),
        options: z
          .array(z.string())
          .max(4)
          .describe("Two to four concrete answers the owner can tap. Empty for an open question."),
      }),
    )
    .max(3)
    .describe("What you still need to know. Ask the most valuable one first."),
  done: z.boolean().describe("True when the agent is complete enough to test."),
});

type IncomingTurn = { readonly role?: unknown; readonly text?: unknown };

function readTurns(value: unknown): { role: "user" | "assistant"; text: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((turn): turn is IncomingTurn => Boolean(turn) && typeof turn === "object")
    .map((turn) => ({
      role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: typeof turn.text === "string" ? turn.text : "",
    }))
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-MAX_TURNS);
}

/** What the model is told about the business it is designing an agent for. */
async function businessContext(): Promise<string[]> {
  const [identity, record, documents] = await Promise.all([
    getBusinessIdentity(),
    getBusinessProfile(),
    listDocuments().catch(() => []),
  ]);

  const lines: string[] = ["## The business this agent works for", ""];
  const identityLines = [
    identity.name ? `Name: ${identity.name}` : null,
    identity.description ? `What it does: ${identity.description}` : null,
    identity.websiteUrl ? `Website: ${identity.websiteUrl}` : null,
    identity.address ? `Address: ${identity.address}` : null,
    identity.hours ? `Hours: ${identity.hours}` : null,
    identity.phone ? `Phone: ${identity.phone}` : null,
  ].filter((line): line is string => line !== null);

  if (identityLines.length > 0) {
    lines.push(...identityLines, "");
  }

  if (record) {
    const { profile } = record;
    lines.push(
      `Industry: ${profile.industry}`,
      profile.description,
      profile.services.length > 0 ? `Services: ${profile.services.join(", ")}` : "",
      profile.tone ? `House tone: ${profile.tone}` : "",
      "",
    );
  }

  lines.push(
    documents.length > 0
      ? `Knowledge base: ${documents.length} document(s) indexed (${documents
          .slice(0, 8)
          .map((document) => document.name)
          .join(", ")}). The agent can quote them with search_knowledge, so never ask the owner to paste prices or policies into the prompt.`
      : "Knowledge base: empty. If the agent needs prices, policies or a catalog, tell the owner to upload them on the Conocimiento page rather than writing them into the prompt.",
    "",
  );

  if (identityLines.length === 0 && !record) {
    lines.push(
      "Nothing about the business has been filled in yet. Ask what the business does before anything else, and keep it to one question.",
      "",
    );
  }
  return lines;
}

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const refused = await guardAiRoute(request, "agents-assistant", undefined, "agent_design");
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

  const input = body as {
    prompt?: string;
    turns?: unknown;
    draft?: {
      name?: string;
      description?: string;
      brief?: Partial<AgentBrief>;
      capabilities?: string[];
    };
    locale?: unknown;
  };

  const prompt = input.prompt?.trim();
  if (!prompt) return missingField("prompt");

  const { modelId, provider } = await resolveTaskModel("agent_design", undefined, request);
  const health = await getProviderReport(provider);
  if (health.status === "missing" || health.status === "invalid") {
    return apiError("no_credentials");
  }

  const locale = input.locale === "en" ? "en" : "es";
  const draftBrief = normalizeBrief(input.draft?.brief);
  const draftCapabilities = Array.isArray(input.draft?.capabilities) ? input.draft.capabilities : [];

  const system = [
    "You are the builder that designs one AI agent for a small business, by",
    "interviewing its owner. The owner is not technical: never mention prompts,",
    "tokens, models or tools by their internal names.",
    "",
    "Every turn you do two things: fill in what the owner's message just decided,",
    "and ask the next thing you actually need. One question at a time is the",
    "default; three is the absolute maximum, and only when they are trivially",
    "related. Offer tappable options whenever the answer is a choice.",
    "",
    "Never ask something the business context below already answers. Never ask",
    "for prices, catalogs or policies — those live in the knowledge base.",
    "",
    ...(await businessContext()),
    "## What an agent is made of",
    "",
    "- name / description: how the owner recognises it in a list.",
    "- brief.role: the job, one line.",
    "- brief.goal: what a good conversation ends with.",
    "- brief.audience: who is on the other side.",
    "- brief.tone: how it sounds, in the owner's own words.",
    "- brief.language: an ISO 639-1 code, or \"auto\" to mirror the customer.",
    "- brief.greeting: what it opens with.",
    "- brief.rules: standing dos. Concrete, not motivational.",
    "- brief.avoid: hard limits — what it must never say, promise or do.",
    "- brief.handoff: exactly when to fetch a human.",
    "- capabilities: what it is allowed to reach for, from this catalog:",
    "",
    ...CAPABILITIES.map((capability) => `  - ${capability.id}${capability.sensitive ? " (sensitive: only when explicitly asked for)" : ""}`),
    "",
    "Always include \"handoff\" in capabilities: an agent with no way to fetch a",
    "person is a trap for the customer. `capabilities` is always the complete",
    "list you want the agent to end up with, not a delta.",
    "",
    "## The draft as it stands",
    "",
    `Name: ${input.draft?.name?.trim() || "(empty)"}`,
    `Description: ${input.draft?.description?.trim() || "(empty)"}`,
    `Role: ${draftBrief.role || "(empty)"}`,
    `Goal: ${draftBrief.goal || "(empty)"}`,
    `Audience: ${draftBrief.audience || "(empty)"}`,
    `Tone: ${draftBrief.tone || "(empty)"}`,
    `Language: ${draftBrief.language}`,
    `Greeting: ${draftBrief.greeting || "(empty)"}`,
    `Rules: ${draftBrief.rules.length > 0 ? draftBrief.rules.join(" | ") : "(none)"}`,
    `Never: ${draftBrief.avoid.length > 0 ? draftBrief.avoid.join(" | ") : "(none)"}`,
    `Handoff: ${draftBrief.handoff || "(empty)"}`,
    `Capabilities: ${draftCapabilities.length > 0 ? draftCapabilities.join(", ") : "(none)"}`,
    "",
    "## Output",
    "",
    `Write every user-facing string in ${locale === "en" ? "English" : "Spanish (rioplatense, voseo)"}.`,
    "Set unchanged patch fields to null. Fill changed fields with what this turn decided — repeating unchanged fields",
    "makes the proposal unreadable. Set `done` once role, goal, tone, handoff and",
    "capabilities are all settled and the agent is worth testing.",
  ].join("\n");

  const turns = readTurns(input.turns);
  const conversation = turns
    .map((turn) => `${turn.role === "user" ? "Owner" : "You"}: ${turn.text}`)
    .join("\n");

  try {
    const result = await generateObject({
      model: resolveLanguageModel(modelId, provider),
      schema: answerSchema,
      system,
      prompt: conversation ? `${conversation}\nOwner: ${prompt}` : `Owner: ${prompt}`,
      abortSignal: AbortSignal.timeout(60_000),
    });
    await recordRouteUsage({
      model: modelId,
      provider,
      usage: result.usage, providerMetadata: result.providerMetadata,
      conversationId: "agents-assistant",
    });

    // Only the proposal comes back. Composing the prompt happens in one place
    // — the PUT that saves the applied brief — so that a patch shown here and
    // a prompt stored later can never be two different pieces of writing.
    const { patch, ...answer } = result.object;
    // null means unchanged; preserve explicit empty strings/arrays as edits.
    const compact = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
    return NextResponse.json({ answer: { ...answer, patch: compact({
      ...patch,
      brief: patch.brief === null ? null : compact(patch.brief),
    }) } });
  } catch (error) {
    return aiGenerationFailure(error, "agents-assistant");
  }
});
