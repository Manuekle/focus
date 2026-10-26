import { NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import {
  renderTemplateById,
  renderTemplateSource,
  TemplateRenderError,
} from "@/lib/email-render";
import { sendAppEmail } from "@/lib/email-send";
import { getTemplateMeta, isBuiltinTemplate, renderSubject } from "@/lib/email-templates";
import { RESEND_SANDBOX_FROM } from "@/lib/resend";
import { requireOwner } from "@/lib/owner-gate";
import { rateLimit } from "@/lib/rate-limit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/email-templates/[id]/test — send the template, for real, to one
 * address.
 *
 * The whole point is that what lands in the inbox is what an automation would
 * send: same render, same subject, same provider. It used to mail the
 * template's own source code in a `<pre>`, which proved nothing.
 *
 * Owner-only and budgeted, for the preview's reason (custom source runs in
 * `node:vm`) and its own: every call is a real email from the install's
 * sender address.
 */
export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireOwner(request, "Only the installation owner can send test emails.");
  if (denied) return denied;
  if (!(await rateLimit("email-test", request, { max: 10, windowMs: 10 * 60_000 })).allowed) {
    return apiError("rate_limited", { status: 429 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    to?: string;
    subject?: string;
    source?: string;
    variables?: Record<string, unknown>;
    locale?: unknown;
  };

  const to = body.to?.trim();
  if (!to) return missingField("to");
  if (!EMAIL_PATTERN.test(to)) {
    return apiError("invalid_field", { field: "to", message: `"${to}" isn't an email address.` });
  }

  const meta = await getTemplateMeta(id);
  if (!meta) return apiError("not_found", { message: `No template named "${id}".` });

  const variables = { ...meta.sample, ...(body.variables ?? {}) };

  let rendered;
  try {
    rendered =
      body.source && !isBuiltinTemplate(id)
        ? await renderTemplateSource(body.source, variables)
        : await renderTemplateById(id, variables);
  } catch (error) {
    if (error instanceof TemplateRenderError) {
      return apiError("unprocessable", { message: error.message });
    }
    throw error;
  }

  const subject = renderSubject(body.subject?.trim() || meta.subject || meta.label, variables);
  const result = await sendAppEmail({
    to,
    subject,
    html: rendered.html,
    text: rendered.text,
    locale: body.locale,
  });

  if (!result.success) {
    return apiError("upstream_failed", {
      message: result.error ?? "The email provider didn't accept the message.",
    });
  }

  // Resend's sandbox sender only delivers to the address that owns the API
  // key. Saying so here is the difference between "it worked" and twenty
  // minutes wondering where the email went.
  const sandbox =
    result.via === "resend" && result.from === RESEND_SANDBOX_FROM;

  return NextResponse.json({
    ok: true,
    id: result.id,
    via: result.via,
    subject,
    sandbox,
    // What the email went out as, and anything inbox providers will score
    // against it — surfaced so a `no-reply` or root-domain sender gets fixed
    // in Settings instead of quietly hurting deliverability.
    ...(result.from ? { from: result.from } : {}),
    senderWarnings: result.senderWarnings ?? [],
  });
});
