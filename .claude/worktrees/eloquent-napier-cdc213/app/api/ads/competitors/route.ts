import { NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { featureGate } from "@/lib/features-gate";
import { addCompetitorAd, competitorsReport, importCompetitor, removeCompetitor } from "@/lib/ad-competitors";
import { ApifyError } from "@/lib/apify-ads";
import { hasTypesafe } from "@/lib/typesafe";

export const dynamic = "force-dynamic";
// An import is one Apify run (up to three minutes on a slow page) and then up
// to 30 Jev calls, four at a time.
export const maxDuration = 300;

// GET    /api/ads/competitors                          — competitors' ads with their grades
// POST   /api/ads/competitors { url }                  — import from a page or Ad Library link
// POST   /api/ads/competitors { competitor, primaryText, headline? } — add one by hand
// DELETE /api/ads/competitors?competitor=<name>        — forget a competitor

/** Apify's refusal, as a code the panel words. `detail` carries the reason. */
function apifyFailure(error: ApifyError) {
  switch (error.reason) {
    case "no_token":
      return apiError("not_configured", { field: "APIFY_API_TOKEN", status: 400, detail: error.reason });
    case "unauthorized":
      return apiError("unauthorized", { field: "APIFY_API_TOKEN", detail: error.reason });
    case "payment":
      return apiError("forbidden", { detail: error.reason });
    case "timeout":
      return apiError("timeout", { detail: error.reason });
    case "bad_url":
      return apiError("invalid_field", { field: "url", detail: error.reason });
    default:
      return apiError("upstream_failed", { detail: error.reason });
  }
}

export const GET = withApiErrors(async function GET() {
  const off = await featureGate("ads.competitors");
  if (off) return off;
  return NextResponse.json(await competitorsReport());
});

export const POST = withApiErrors(async function POST(request: Request) {
  const off = await featureGate("ads.competitors");
  if (off) return off;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError("invalid_json");

  if (typeof body.url === "string") {
    try {
      const result = await importCompetitor(body.url.slice(0, 500));
      return NextResponse.json({ ...result, ...(await competitorsReport()) });
    } catch (error) {
      if (error instanceof ApifyError) return apifyFailure(error);
      throw error;
    }
  }

  const competitor = typeof body.competitor === "string" ? body.competitor.trim().slice(0, 120) : "";
  const primaryText = typeof body.primaryText === "string" ? body.primaryText.trim().slice(0, 3000) : "";
  if (!competitor) return missingField("competitor");
  if (!primaryText) return missingField("primaryText");
  if (!(await hasTypesafe())) {
    return apiError("not_configured", { field: "TYPESAFE_API_KEY", status: 400 });
  }
  const headline = typeof body.headline === "string" ? body.headline.slice(0, 300) : undefined;
  const ad = await addCompetitorAd({ competitor, primaryText, headline });
  return NextResponse.json({ ad, ...(await competitorsReport()) });
});

export const DELETE = withApiErrors(async function DELETE(request: Request) {
  const off = await featureGate("ads.competitors");
  if (off) return off;
  const competitor = new URL(request.url).searchParams.get("competitor");
  if (!competitor) return missingField("competitor");
  const removed = await removeCompetitor(competitor);
  return NextResponse.json({ removed, ...(await competitorsReport()) });
});
