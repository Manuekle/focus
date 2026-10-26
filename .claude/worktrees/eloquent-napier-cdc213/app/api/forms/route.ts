import { createForm, listFormResponses, listForms } from "@/lib/business-store";
import { getTemplate, templateToForm } from "@/lib/forms/templates";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/dictionaries";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

/** The list screen wants a count next to each form, and counting on the client
 *  would mean shipping every response to draw a number. */
export const GET = withApiErrors(async function GET() {
  const [forms, responses] = await Promise.all([listForms(), listFormResponses()]);
  const counts = new Map<string, { total: number; completed: number }>();
  for (const response of responses) {
    const entry = counts.get(response.formId) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (!response.partial) entry.completed += 1;
    counts.set(response.formId, entry);
  }
  return NextResponse.json({
    forms: forms.map((form) => ({
      ...form,
      responseCount: counts.get(form.id)?.total ?? 0,
      completedCount: counts.get(form.id)?.completed ?? 0,
    })),
  });
});

/** Create a form from one of the templates. There is no from-scratch path that
 *  isn't a template: "blank" is a template with one question in it, so the
 *  builder always opens on something rather than on an empty screen. */
export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as { templateId?: string; locale?: string; name?: string };
  if (!input.templateId) return missingField("templateId");

  const template = getTemplate(input.templateId);
  if (!template) {
    return apiError("invalid_field", { message: `Unknown template "${input.templateId}".` });
  }

  const locale: Locale = input.locale === "en" || input.locale === "es" ? input.locale : DEFAULT_LOCALE;
  const seed = templateToForm(template, locale);
  const form = await createForm({ ...seed, name: input.name?.trim() || seed.name });
  return NextResponse.json({ ok: true, form });
});
