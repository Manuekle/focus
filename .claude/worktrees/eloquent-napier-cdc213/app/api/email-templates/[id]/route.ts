import { NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { designToSource, normalizeDesign } from "@/lib/email-design";
import { extractTemplateVariables } from "@/lib/email-render";
import {
  deleteCustomTemplate,
  getTemplateMeta,
  getTemplateSource,
  isBuiltinTemplate,
  saveCustomTemplate,
} from "@/lib/email-templates";
import { requireOwner } from "@/lib/owner-gate";
import { SITE_URL } from "@/lib/site";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/email-templates/[id] — source plus metadata.
export const GET = withApiErrors(async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const meta = await getTemplateMeta(id);
  if (!meta) return apiError("not_found", { message: `No template named "${id}".` });
  // Built-in source is for reading only, and can legitimately be absent in a
  // standalone build where the `.tsx` files aren't shipped.
  return NextResponse.json({ template: meta, source: await getTemplateSource(id) });
});

// PUT /api/email-templates/[id] — save a custom template. Owner-only, for
// the same reason as creating one: the saved source is evaluated later.
export const PUT = withApiErrors(async function PUT(request: Request, { params }: RouteParams) {
  const denied = await requireOwner(request, "Only the installation owner can edit email templates.");
  if (denied) return denied;

  const { id } = await params;

  if (isBuiltinTemplate(id)) {
    return apiError("forbidden", {
      message: "Built-in templates are read-only — duplicate one to edit it.",
    });
  }

  const current = await getTemplateMeta(id);
  if (!current) return apiError("not_found", { message: `No template named "${id}".` });

  const body = (await request.json()) as {
    source?: string;
    label?: string;
    description?: string;
    subject?: string;
    sample?: Record<string, unknown>;
    design?: unknown;
  };

  const sentDesign = body.design === undefined ? null : normalizeDesign(body.design);
  if (body.design !== undefined && !sentDesign) {
    return apiError("invalid_field", { field: "design", message: "The design is not a list of blocks." });
  }
  // A visual template's source is always regenerated from its blocks — on a
  // subject-only save too, since a field in the subject becomes a prop.
  const design = sentDesign ?? current.design ?? null;
  const label = body.label?.trim() || current.label;
  const subject = body.subject?.trim() || current.subject || label;
  const source = design
    ? designToSource(design, subject, SITE_URL)
    : (body.source ?? (await getTemplateSource(id)) ?? "");
  const variables = await extractTemplateVariables(source);

  // Sample values for variables the edit removed are dropped rather than kept
  // as dead keys in the meta file.
  const incoming = { ...current.sample, ...(body.sample ?? {}) };
  const sample = Object.fromEntries(
    variables.filter((v) => incoming[v] !== undefined).map((v) => [v, incoming[v]]),
  );

  const saved = await saveCustomTemplate(id, source, {
    label,
    description: body.description ?? current.description,
    subject,
    variables,
    sample,
    ...(design ? { design } : {}),
  });

  return NextResponse.json({ template: saved });
});

// DELETE /api/email-templates/[id] — remove a custom template.
export const DELETE = withApiErrors(async function DELETE(
  _request: Request,
  { params }: RouteParams,
) {
  const { id } = await params;

  if (isBuiltinTemplate(id)) {
    return apiError("forbidden", { message: "Built-in templates can't be deleted." });
  }
  if (!(await deleteCustomTemplate(id))) {
    return apiError("not_found", { message: `No template named "${id}".` });
  }
  return NextResponse.json({ ok: true });
});
