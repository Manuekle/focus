import { NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { featureGate } from "@/lib/features-gate";
import { reviewDraft } from "@/lib/ad-creatives";
import { hasTypesafe } from "@/lib/typesafe";

export const dynamic = "force-dynamic";

// POST /api/ads/review { primaryText, headline?, cta? } — grade a draft before
// it is published. Needs no Meta connection: the words are all it reads.

/** Meta's own limit on primary text is far above this; a draft longer than it
 *  is a pasted document, not an ad. */
const MAX_TEXT = 3_000;

export const POST = withApiErrors(async function POST(request: Request) {
  const off = await featureGate("ads.creatives");
  if (off) return off;
  if (!(await hasTypesafe())) {
    return apiError("not_configured", { field: "TYPESAFE_API_KEY", status: 400 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError("invalid_json");

  const primaryText = typeof body.primaryText === "string" ? body.primaryText.trim() : "";
  if (!primaryText) return missingField("primaryText");
  if (primaryText.length > MAX_TEXT) return apiError("too_large", { field: "primaryText" });
  const headline = typeof body.headline === "string" ? body.headline.slice(0, 300) : undefined;
  const cta = typeof body.cta === "string" ? body.cta.slice(0, 60) : undefined;

  const grade = await reviewDraft({ primaryText, headline, cta });
  if (!grade) return apiError("upstream_failed", { message: "Jev did not answer. Try again in a moment." });
  return NextResponse.json({ grade });
});
