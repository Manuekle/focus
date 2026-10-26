import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
} from "@/lib/skill-store";
import { getSkillTemplate, templateContent } from "@/lib/skill-templates";
import { readLocale } from "@/lib/i18n/server";

// The owner's skills.
//
// A skill saved here is live on the agent's next turn — agent/skills/user-skills.ts
// resolves the store on `turn.started`. There is no deploy step and no cache
// to bust, which is the whole reason these are stored rather than authored.

/** A description is not optional in practice: eve advertises it on every turn
 *  and routes on it, so an empty one is a skill the model can never decide to
 *  load. Rejected at the boundary rather than papered over with a default,
 *  because the default would be wrong in a way nobody would notice. */
function validate(input: {
  name?: unknown;
  description?: unknown;
  markdown?: unknown;
}): string | null {
  if (typeof input.name !== "string" || !input.name.trim()) return "name";
  if (typeof input.description !== "string" || !input.description.trim()) return "description";
  if (typeof input.markdown !== "string" || !input.markdown.trim()) return "markdown";
  return null;
}

export const GET = withApiErrors(async function GET() {
  return NextResponse.json({ skills: await listSkills() });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as Record<string, unknown>;

  // Starting from a template: the client sends only the id, and the body is
  // filled in here so the two never drift out of step with lib/skill-templates.ts.
  if (typeof input.templateId === "string" && !input.markdown) {
    const template = getSkillTemplate(input.templateId);
    if (!template) return apiError("not_found");
    // The body is seeded in the caller's language: a skill is a document the
    // owner then edits, and one that opens in the other language is one they
    // have to rewrite rather than fill in.
    const content = templateContent(template, readLocale(input.locale));
    const created = await createSkill({
      name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : content.name,
      description: content.description,
      markdown: content.markdown,
      source: "template",
      templateId: template.id,
      // A template lands disabled. It ships with `[completar]` blanks, and a
      // half-written policy advertised to the model on every turn is worse
      // than no policy at all.
      enabled: false,
      agentIds: input.agentIds,
    });
    return NextResponse.json({ ok: true, skill: created });
  }

  const missing = validate(input);
  if (missing) return missingField(missing);

  const created = await createSkill({
    name: input.name as string,
    description: input.description as string,
    markdown: input.markdown as string,
    source: input.source ?? "manual",
    ...(typeof input.documentId === "string" ? { documentId: input.documentId } : {}),
    ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
    agentIds: input.agentIds,
  });
  return NextResponse.json({ ok: true, skill: created });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input.id !== "string" || !input.id) return missingField("id");

  const updated = await updateSkill(input.id, {
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.markdown === "string" ? { markdown: input.markdown } : {}),
    ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
    ...(input.agentIds !== undefined ? { agentIds: input.agentIds } : {}),
  });
  if (!updated) return apiError("not_found");
  return NextResponse.json({ ok: true, skill: updated });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return missingField("id");
  const deleted = await deleteSkill(id);
  if (!deleted) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
