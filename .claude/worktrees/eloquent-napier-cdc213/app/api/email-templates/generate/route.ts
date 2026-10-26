import { generateObject } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveTaskModel } from "@/lib/task-model";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { getProviderReport } from "@/lib/provider-catalog";
import { BLOCK_ALIGNS, BLOCK_TYPES, designVariables, normalizeDesign } from "@/lib/email-design";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { guardAiRoute, recordRouteUsage } from "@/lib/ai-route-guard";
import { aiGenerationFailure } from "@/lib/ai-generation-error";
import { requireOwner } from "@/lib/owner-gate";

// POST /api/email-templates/generate
// Turns a plain-language description into a complete visual template — label,
// subject, sample data and the blocks themselves. Never writes: the editor
// creates the template from the draft and opens it, so reviewing the AI's work
// is the same as editing anything else.

const emailDraftSchema = z.object({
  label: z.string().describe("Short template name, 2-5 words, in the user's language"),
  description: z.string().describe("One-line summary of when to send this email"),
  subject: z
    .string()
    .describe("Email subject line. Use {{fieldName}} for placeholders that also appear in the blocks."),
  accentColor: z.string().describe("Button colour as a 6-digit hex, e.g. #1f2937. Pick one that suits the email."),
  blocks: z
    .array(
      z.object({
        type: z.enum(BLOCK_TYPES),
        text: z
          .string()
          .describe("The words: a heading, a paragraph (use \\n for line breaks), a button label or a footer note. Empty for divider and spacer."),
        url: z.string().describe("A button's link, or an image's address. Empty string otherwise."),
        align: z.enum(BLOCK_ALIGNS),
      }),
    )
    .describe("The email, top to bottom"),
  sampleValues: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe("One realistic sample value per {{field}} used anywhere, for the live preview"),
});

const system = [
  "You write emails for small businesses, as a list of blocks a non-technical",
  "owner can rearrange. The user describes the email they want in plain language.",
  "",
  "## Blocks",
  "",
  "- heading: a short title.",
  "- text: a paragraph. Keep each one short; split long copy into several.",
  "- button: one clear call to action, with its link in `url`.",
  "- image: only when the user gives you an image address. Never invent one.",
  "- divider: a thin line between sections.",
  "- spacer: extra room.",
  "- footer: small print at the bottom (who sent it, how to opt out).",
  "",
  "## Fields",
  "",
  "Anything that changes per recipient is a field written {{fieldName}} — a",
  "name, a date, a link. Field names are camelCase letters only, e.g.",
  "{{nombre}}, {{fechaTurno}}, {{enlace}}. A button whose link changes per",
  "recipient uses a field as its url. Give every field a sample value.",
  "",
  "## Style",
  "",
  "- 3 to 8 blocks. One heading, one button at most unless the user asks.",
  "- Warm, direct copy in the same language as the user's request, including",
  "  the label, the subject and the button labels.",
].join("\n");

// A whole email plus sample data is a bigger completion than a short config
// object, so this gets more room than the other AI-assist routes.
export const maxDuration = 90;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  // Owner-only, like every other way of writing a template.
  const denied = await requireOwner(request, "Only the installation owner can generate email templates.");
  if (denied) return denied;

  const refused = await guardAiRoute(request, "email-generate", undefined, "automation");
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

  const input = body as { prompt?: string };
  const prompt = input.prompt?.trim();
  if (!prompt) {
    return missingField("prompt");
  }

  const { modelId, provider } = await resolveTaskModel("automation", undefined, request);
  const health = await getProviderReport(provider);
  if (health.status === "missing" || health.status === "invalid") {
    return apiError("no_credentials");
  }

  let draft: z.infer<typeof emailDraftSchema>;
  try {
    const result = await generateObject({
      model: resolveLanguageModel(modelId, provider),
      schema: emailDraftSchema,
      system,
      prompt: `The user wants an email template for: ${prompt}`,
      abortSignal: AbortSignal.timeout(80_000),
    });
    await recordRouteUsage({ model: modelId, provider, usage: result.usage, providerMetadata: result.providerMetadata, conversationId: "email-generate" });
    draft = result.object;
  } catch (error) {
    return aiGenerationFailure(error, "email-generate");
  }

  // Blocks are data, not code, so there is nothing to compile: normalizing
  // drops whatever the model got wrong (an unknown block, a script link), and
  // the field list is read off what is left rather than off the model's own
  // `sampleValues`, which can drift from it.
  const design = normalizeDesign({
    theme: { accent: draft.accentColor },
    blocks: draft.blocks.map((block) => ({ ...block, size: "md" })),
  });
  if (!design || design.blocks.length === 0) {
    return apiError("generation_failed", { detail: "The draft had no usable blocks." });
  }

  const sample: Record<string, unknown> = {};
  for (const name of designVariables(design, draft.subject)) {
    sample[name] = draft.sampleValues.find((v) => v.name === name)?.value ?? "";
  }

  return NextResponse.json({
    label: draft.label,
    description: draft.description,
    subject: draft.subject,
    design,
    sample,
  });
});
