import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { SKILL_TEMPLATES, TEMPLATE_PLACEHOLDER, templateContent } from "@/lib/skill-templates";
import { readLocale } from "@/lib/i18n/server";

// The template catalogue, in one language.
//
// Served rather than imported into the client bundle, and served per locale
// rather than whole: the six markdown bodies are several kilobytes each, only
// one of them is ever used — the one somebody picks — and shipping the other
// language's copies as well would double a payload that is already mostly
// waste. Same reasoning that split lib/i18n/dictionaries.ts into two chunks.
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const locale = readLocale(request.nextUrl.searchParams.get("locale"));
  return NextResponse.json({
    placeholder: TEMPLATE_PLACEHOLDER,
    templates: SKILL_TEMPLATES.map((template) => ({
      id: template.id,
      category: template.category,
      ...templateContent(template, locale),
    })),
  });
});
