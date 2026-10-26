import { NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { designToSource, normalizeDesign } from "@/lib/email-design";
import { emailPreset } from "@/lib/email-presets";
import { extractTemplateVariables } from "@/lib/email-render";
import { isSmtpConfigured } from "@/lib/email";
import { requireOwner } from "@/lib/owner-gate";
import {
  getResendSender,
  isResendConfigured,
  RESEND_SANDBOX_FROM,
} from "@/lib/resend";
import {
  isBuiltinTemplate,
  listTemplates,
  saveCustomTemplate,
  type CustomTemplateMeta,
} from "@/lib/email-templates";
import { SITE_URL } from "@/lib/site";
import { readLocale } from "@/lib/i18n/server";

// GET /api/email-templates — every template, plus who would send them.
export const GET = withApiErrors(async function GET(request: Request) {
  const locale = readLocale(new URL(request.url).searchParams.get("locale"));
  const [templates, resend, smtp, sender] = await Promise.all([
    listTemplates(),
    isResendConfigured(),
    isSmtpConfigured(),
    getResendSender(locale),
  ]);
  return NextResponse.json({
    templates,
    // The test panel needs this to say who's about to send, and to warn about
    // Resend's sandbox sender before someone waits for an email that only ever
    // reaches the account owner — and about a no-reply or root-domain sender
    // before inbox providers score it.
    provider: {
      resend,
      smtp,
      from: sender.from,
      sandbox: resend && sender.from === RESEND_SANDBOX_FROM,
      senderWarnings: sender.warnings,
    },
  });
});

// POST /api/email-templates — create a custom template. Owner-only: the
// source is code that previews, test sends and automations evaluate in this
// process (see lib/email-render.ts).
export const POST = withApiErrors(async function POST(request: Request) {
  const denied = await requireOwner(request, "Only the installation owner can create email templates.");
  if (denied) return denied;

  const body = (await request.json()) as {
    id?: string;
    label?: string;
    description?: string;
    subject?: string;
    source?: string;
    sample?: Record<string, unknown>;
    design?: unknown;
  };

  const id = body.id?.trim() || `custom-${Date.now()}`;
  if (isBuiltinTemplate(id)) {
    return apiError("conflict", {
      message: `"${id}" is a built-in template — pick another id.`,
      field: "id",
    });
  }

  // A visual template arrives as blocks and its source is generated here, so
  // the code that runs is always what the blocks say. One that brings neither
  // blocks nor code starts from the blank visual preset.
  const design = body.design === undefined ? null : normalizeDesign(body.design);
  if (body.design !== undefined && !design) {
    return apiError("invalid_field", { field: "design", message: "The design is not a list of blocks." });
  }
  const starter = !design && !body.source ? emailPreset("blank", "es") : null;
  const blocks = design ?? starter?.design ?? null;
  const label = body.label?.trim() || starter?.label || "Nueva plantilla";
  const subject = body.subject?.trim() || starter?.subject || label;
  const source = blocks ? designToSource(blocks, subject, SITE_URL) : (body.source ?? "");

  // Read off the source rather than trusting the caller: the variable list is
  // what the editor renders inputs from, and a wrong one is invisible until an
  // email goes out with a hole in it.
  const variables = await extractTemplateVariables(source);
  const sample = body.sample ?? starter?.sample ?? {};

  const meta: CustomTemplateMeta = {
    label,
    description: body.description ?? "",
    subject,
    variables,
    sample,
    ...(blocks ? { design: blocks } : {}),
  };

  const saved = await saveCustomTemplate(id, source, meta);
  return NextResponse.json({ template: saved, source }, { status: 201 });
});
