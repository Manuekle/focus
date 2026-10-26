import { generateObject } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { guardAiRoute, recordRouteUsage } from "@/lib/ai-route-guard";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { resolveTaskModel } from "@/lib/task-model";
import { documentText } from "@/lib/knowledge-store";
import { createSkill, skillForDocument } from "@/lib/skill-store";
import { aiGenerationFailure } from "@/lib/ai-generation-error";

// Promote an uploaded document into a skill.
//
// The distinction this route exists to make, and the reason it is not just a
// copy-paste of the file into a text field:
//
//   A **document** is retrieved. `search_knowledge` finds the passages that
//   match a question, which is exactly right for a price list — nobody needs
//   the whole catalogue to answer "how much is the blue one".
//
//   A **skill** is loaded whole. That is what a procedure needs: half a refund
//   policy, returned because those two paragraphs scored highest, is worse
//   than none, because the model will answer confidently from the half it got.
//
// So this rewrites rather than copies. A PDF of internal notes is not a
// procedure; the model turns it into one — a routing description, ordered
// steps, and the "when NOT to use this" section that people never write and
// that stops a skill from firing on every message.
//
// The document stays in the knowledge base. Promotion adds, never moves.

const SkillDraft = z.object({
  name: z
    .string()
    .describe("Nombre corto del procedimiento, 2-4 palabras, en el idioma del documento."),
  description: z
    .string()
    .describe(
      "Cuándo debe cargarse esta habilidad, escrito como la tarea que la dispara. " +
        "Una frase. Es lo único que el modelo ve en cada turno.",
    ),
  markdown: z
    .string()
    .describe("El procedimiento completo en markdown, con las secciones pedidas."),
});

const SYSTEM = `Convertís un documento de un negocio en una habilidad cargable por un agente.

Una habilidad NO es un resumen. Es un procedimiento: qué hacer, en qué orden, y
con qué límites. Escribila así:

# <Nombre>

## Cuándo usarla
Dos o tres viñetas con las situaciones concretas, en las palabras que usaría un
cliente o el dueño del negocio.

## Cuándo NO usarla
Al menos una viñeta. Es la sección que evita que la habilidad se cargue en cada
mensaje.

## Pasos
Numerados. Cada paso es una acción, no una explicación.

## Reglas duras
Lo que nunca se hace o se promete.

## Cuándo llamamos a una persona
Cuándo hay que dejar de responder y pasar a alguien del equipo.

Reglas de escritura:
- Usá SOLO lo que dice el documento. No agregues políticas, precios ni plazos
  que no estén ahí.
- Si el documento no dice algo que la sección necesita, escribí la línea con
  "[completar]" en vez de inventarla.
- Mismo idioma que el documento.
- Nada de preámbulos ni de comentarios sobre el documento.`;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const guard = await guardAiRoute(request, "skill-from-document", {
    max: 10,
    windowMs: 5 * 60_000,
  }, "agent_design");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as { documentId?: string; agentIds?: unknown };
  if (!input.documentId) return missingField("documentId");

  // Promoting the same document twice would advertise two near-identical
  // descriptions to the model on every turn, which is how you get a router
  // that picks neither.
  const already = await skillForDocument(input.documentId);
  if (already) {
    return apiError("conflict", {
      message: `Ese documento ya es la habilidad "${already.name}".`,
      detail: already.id,
    });
  }

  const source = await documentText(input.documentId);
  if (!source) return apiError("not_found", { message: "Ese documento no existe." });
  if (source.text.trim().length < 120) {
    return apiError("unprocessable", {
      message: "El documento es demasiado corto para sacar un procedimiento de ahí.",
    });
  }

  const { modelId, provider } = await resolveTaskModel("agent_design", undefined, request);
  try {
    const result = await generateObject({
      model: resolveLanguageModel(modelId, provider),
      schema: SkillDraft,
      system: SYSTEM,
      prompt: `Documento: ${source.document.name}\n\n${source.text}`,
      abortSignal: AbortSignal.timeout(60_000),
    });
    await recordRouteUsage({
      model: modelId,
      provider,
      usage: result.usage, providerMetadata: result.providerMetadata,
      conversationId: `skill:${input.documentId}`,
    });

    const skill = await createSkill({
      name: result.object.name,
      description: result.object.description,
      markdown: result.object.markdown,
      source: "knowledge",
      documentId: input.documentId,
      // Off until somebody reads it. The model just wrote a policy from a PDF
      // and may have written `[completar]` into the middle of it; that is a
      // draft, not something to put in front of customers unreviewed.
      enabled: false,
      agentIds: input.agentIds,
    });
    return NextResponse.json({ ok: true, skill });
  } catch (error) {
    return aiGenerationFailure(error, "skill-from-document");
  }
});
