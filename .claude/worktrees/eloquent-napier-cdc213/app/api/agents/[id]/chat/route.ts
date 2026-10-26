import { BUSINESS_CONVERSATION_POLICY, CUSTOMER_VOICE_POLICY } from "@/lib/agent-conversation-policy";
import { stepCountIs, streamText, tool, type ModelMessage } from "ai";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { getAgent } from "@/lib/business-store";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { resolveTaskModel } from "@/lib/task-model";
import { getProviderReport } from "@/lib/provider-catalog";
import { listDocuments } from "@/lib/knowledge-store";
import { findMedia } from "@/lib/media-library";
import { countAssets } from "@/lib/media-store";
import { RagError, searchKnowledge } from "@/lib/rag";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { guardAiRoute, recordRouteUsage } from "@/lib/ai-route-guard";
import { toCapabilityIds, type CapabilityId } from "@/lib/agent-capabilities";

// POST /api/agents/[id]/chat
//
// The text half of the agent playground: the same prompt the agent runs on in
// production, answered here in a throwaway conversation the browser holds.
//
// Which tools run here is the whole design of this route. The two that only
// *read* the business — the knowledge base and the media library — are wired
// up, because a rehearsal that cannot quote the real price list or find the
// real photo is a rehearsal of a different agent. Everything that reaches
// outside — sending on WhatsApp, writing to the CRM, booking, charging — is
// not, and the agent is told to say what it would do instead. A test chat
// that actually messaged a customer would not be a test.

/** How many turns of the browser's transcript are sent back. Long enough for
 *  a realistic test, short enough that a forgotten dialog can't grow into an
 *  expensive prompt. */
const MAX_TURNS = 40;

type IncomingMessage = { readonly role?: unknown; readonly content?: unknown };

/**
 * The read-only half of the real agent's tool set, as the playground sees it.
 *
 * Same stores, same search, same wording as agent/tools/search_knowledge.ts
 * and agent/tools/find_media.ts — those run inside Eve and cannot be imported
 * into a Next route, so the behaviour is mirrored rather than shared. The one
 * addition is `url` on a media hit: on a channel the agent sends a file, and
 * here it has to render one, which it does by putting that URL in its reply.
 */
const knowledgeTool = tool({
    description:
      "Search the business knowledge base (documents uploaded on the Conocimiento page: " +
      "price lists, catalogs, policies, FAQs). Use this BEFORE answering anything about " +
      "prices, products, services, hours or internal procedures. Quote the retrieved text " +
      "and name the source document.",
    inputSchema: z.object({
      query: z.string().describe("What to look for, in the user's own words and language."),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    async execute({ query, limit }) {
      try {
        const matches = await searchKnowledge(query, { limit: limit ?? 5 });
        if (matches.length === 0) {
          // "Nothing uploaded" and "uploaded, no match" are different answers
          // to give a customer, so they are different answers here too.
          const documents = await listDocuments();
          return {
            found: false,
            message:
              documents.length === 0
                ? "The knowledge base is empty. No documents have been uploaded yet."
                : `No passage in the ${documents.length} indexed document(s) matches that query.`,
          };
        }
        return {
          found: true,
          results: matches.map((match) => ({
            document: match.doc_name,
            excerpt: match.text,
            score: Number(match.score.toFixed(4)),
          })),
          message: `Found ${matches.length} passage(s).`,
        };
      } catch (error) {
        if (error instanceof RagError) return { found: false, message: error.message };
        return { found: false, message: "Knowledge search failed." };
      }
    },
});


const mediaTool = tool({
    description:
      "Search the business's saved photo/video/audio library (files uploaded on the " +
      "Conocimiento page). Use it whenever someone asks to SEE something — 'do you have " +
      "photos of X', 'send me a picture', 'is there a video' — or when showing a file " +
      "answers better than describing it. Each hit carries a `url`: put it in your reply " +
      "so the file is actually shown.",
    inputSchema: z.object({
      query: z.string().describe("What the file should show, in the user's own words and language."),
      kind: z.enum(["image", "video", "audio"]).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    async execute({ query, kind, limit }) {
      const matches = await findMedia(query, { limit: limit ?? 5, kind });
      if (matches.length === 0) {
        const total = await countAssets();
        return {
          found: false,
          message:
            total === 0
              ? "The media library is empty — no photos or videos have been uploaded yet."
              : `None of the ${total} saved file(s) match that.`,
        };
      }
      return {
        found: true,
        results: matches.map((match) => ({
          name: match.name,
          kind: match.kind,
          description: match.description,
          // Served by app/api/media/[id]/file — same-origin, behind the same
          // session as this route, so the playground can render it directly.
          url: `/api/media/${match.id}/file`,
        })),
        message: `Found ${matches.length} file(s).`,
      };
    },
});

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");
  const refused = await guardAiRoute(request, "agents-chat", undefined, agent.model ? undefined : "chat");
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const incoming = (body as { messages?: unknown }).messages;
  if (!Array.isArray(incoming)) return missingField("messages");

  const messages: ModelMessage[] = incoming
    .filter((entry): entry is IncomingMessage => !!entry && typeof entry === "object")
    .filter(
      (entry) =>
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim().length > 0,
    )
    .slice(-MAX_TURNS)
    .map((entry) => ({
      role: entry.role as "user" | "assistant",
      content: (entry.content as string).trim(),
    }));

  if (messages.length === 0) return missingField("messages");

  const selected = agent.model
    ? { modelId: agent.model, provider: undefined }
    : await resolveTaskModel("chat", undefined, request);

  const health = await getProviderReport(selected.provider);
  if (health.status === "missing" || health.status === "invalid") {
    return apiError("no_credentials");
  }

  // The playground runs the same capability list the channels do, so a
  // rehearsal answers the question people actually have — "what will this
  // agent do once it is live?" — instead of a more capable agent's answer.
  // Empty capability lists grant no tools, matching lib/agent-scope.
  const capabilities = toCapabilityIds(agent.tools);
  const allows = (capability: CapabilityId) =>
    capabilities.includes(capability);

  const playgroundTools = {
    ...(allows("knowledge") ? { search_knowledge: knowledgeTool } : {}),
    ...(allows("media") ? { find_media: mediaTool } : {}),
  };

  const connected = [
    allows("knowledge")
      ? "- search_knowledge — the documents the business uploaded. Search it before answering about prices, products, services, hours or policies, and quote the document you found it in."
      : "",
    allows("media") ? "- find_media — the business's saved photos, videos and audio." : "",
  ].filter(Boolean);

  /** Everything the agent is allowed to do live but cannot do from here. */
  const elsewhere = capabilities
    .filter((capability) => capability !== "knowledge" && capability !== "media")
    .join(", ");

  const system = [
    agent.systemPrompt?.trim() ||
      `You are ${agent.name}${agent.description ? `, ${agent.description}` : ""}. Help the person who writes to you.`,
    "",
    BUSINESS_CONVERSATION_POLICY,
    "",
    CUSTOMER_VOICE_POLICY,
    "## Test mode",
    "",
    "You are answering inside this app's agent playground, in text.",
    "",
    connected.length > 0
      ? ["What is connected here, on the real business data:", ...connected].join("\n")
      : "No tools run here at all.",
    "",
    allows("media")
      ? "How to show media and links: each find_media hit carries a `url`. Show an image inline as markdown, `![name](url)`. For a video or audio file, or any other link, write a normal markdown link, `[name](url)`. Never invent a URL — only use one a tool returned or the person gave you."
      : "Never invent a URL — only use one the person gave you.",
    "",
    elsewhere
      ? `Nothing else is connected: what you can do live (${elsewhere}) does not run here. When you would use one — sending on WhatsApp, saving a contact, booking, charging — say in a single short line what you would do, and never claim it already happened.`
      : "Nothing else is connected. Never claim to have performed an action outside this conversation.",
    "Reply in the same language the person writes in.",
    "Keep replies short and conversational, the way they would read on WhatsApp — not a document.",
  ].join("\n");

  // An agent pinned to a model runs on that model; the rest follow whatever
  // the app picks for a chat, same as the messaging channels do.
  const { modelId, provider } = selected;
  const model = resolveLanguageModel(modelId, provider);

  const result = streamText({
    model,
    system,
    messages,
    tools: playgroundTools,
    // Room for a lookup (or two, when a question needs both the price list and
    // the photo) and the answer that follows, without letting a loop run away.
    stopWhen: stepCountIs(6),
    abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    // Usage is only known once the stream ends, so it is recorded from here
    // rather than beside the call — the response has been returned to the
    // browser by then, and `recordRouteUsage` does not block it either way.
    onFinish: async ({ totalUsage, providerMetadata }) => {
      // Awaited, and the callback is async for that reason: `Callback` in the
      // AI SDK returns `PromiseLike<void> | void`, so returning a promise here
      // holds the stream open until the row is written. Fire-and-forget lost
      // every row on Vercel — the instance freezes when the response ends.
      await recordRouteUsage({
        model: modelId,
        provider,
        usage: totalUsage,
        providerMetadata,
        conversationId: `agents-chat:${id}`,
      });
    },
    // Once the first token is out the status line is already sent, so a later
    // provider failure can only end the stream early. Logging it here is what
    // makes that visible on the server instead of silently truncating.
    onError: ({ error }) => {
      console.error("[agents/chat] stream failed", error);
    },
  });

  // The SDK's text-only response drops error parts. Propagate them as stream
  // failures so the browser cannot save a truncated answer as a complete one.
  const text = result.fullStream.pipeThrough(new TransformStream({
    transform(part, controller) {
      if (part.type === "text-delta") controller.enqueue(part.text);
      if (part.type === "error" || part.type === "abort") {
        controller.error(new Error("Agent response interrupted."));
      }
    },
  }));
  return new Response(text.pipeThrough(new TextEncoderStream()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
