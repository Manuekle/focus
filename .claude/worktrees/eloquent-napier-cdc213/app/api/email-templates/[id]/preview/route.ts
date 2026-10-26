import { NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import {
  renderTemplateById,
  renderTemplateSource,
  TemplateRenderError,
} from "@/lib/email-render";
import { getTemplateMeta, isBuiltinTemplate, renderSubject } from "@/lib/email-templates";
import { requireOwner } from "@/lib/owner-gate";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/email-templates/[id]/preview — render a template to the HTML the
 * preview pane shows.
 *
 * The editor posts the source it currently has, unsaved edits and all, so the
 * preview tracks the buffer rather than the file. Built-ins ignore that: they
 * render from the imported component, which is also what gets sent.
 *
 * Owner-only and budgeted: custom source is evaluated in a `node:vm` context,
 * which is not a security boundary (see lib/email-render.ts). The budget is
 * roomy for typing — the editor debounces — and tight for a loop.
 */
export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(request, "Only the installation owner can render email templates.");
  if (denied) return denied;
  if (!(await rateLimit("email-preview", request, { max: 120, windowMs: 60_000 })).allowed) {
    return apiError("rate_limited", { status: 429 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    source?: string;
    /** The subject as typed, before it is saved. */
    subject?: string;
    variables?: Record<string, unknown>;
  };

  const meta = await getTemplateMeta(id);
  if (!meta) return apiError("not_found", { message: `No template named "${id}".` });

  const variables = { ...meta.sample, ...(body.variables ?? {}) };

  try {
    const rendered =
      body.source && !isBuiltinTemplate(id)
        ? await renderTemplateSource(body.source, variables)
        : await renderTemplateById(id, variables);

    return NextResponse.json({
      html: rendered.html,
      text: rendered.text,
      subject: renderSubject(body.subject?.trim() || meta.subject || meta.label, variables),
    });
  } catch (error) {
    if (error instanceof TemplateRenderError) {
      // 200, not 4xx: a template that doesn't compile yet is the normal state
      // of one being typed, and the pane shows the message in place of the
      // email rather than treating it as a request failure.
      return NextResponse.json({ html: null, renderError: error.message });
    }
    throw error;
  }
});
