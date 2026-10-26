import { NextResponse } from "next/server";
import { apiError, apiErrorBody, withApiErrors } from "@/lib/api-error";
import { featureGate } from "@/lib/features-gate";
import { creativesReport } from "@/lib/ad-creatives";
import { getMetaAdsConfig } from "@/lib/meta-ads";
import { metaFailure } from "@/lib/meta-ads-failure";
import { hasTypesafe } from "@/lib/typesafe";

export const dynamic = "force-dynamic";
// A run is up to 40 Jev calls, four at a time, each reading a thumbnail first:
// usually seconds. The ceiling is for a slow Meta CDN or a slow Jev, and each
// grade is saved as it lands (lib/ad-creatives.ts), so even a run cut off here
// keeps its work.
export const maxDuration = 300;

// GET  /api/ads/creatives?date_preset=last_30d — ads, their numbers, stored grades
// POST /api/ads/creatives { date_preset }      — grade what is not graded yet

const DATE_PRESETS = new Set([
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
]);

function datePreset(raw: unknown): string {
  return typeof raw === "string" && DATE_PRESETS.has(raw) ? raw : "last_30d";
}

/** Same 200-with-a-code as /api/ads: no Meta account is a state of the
 *  install, and the Ads page already shows how to connect one. */
function notConfigured() {
  return NextResponse.json(
    apiErrorBody("not_configured", { message: "Meta Ads isn't connected." }),
    { status: 200 },
  );
}

export const GET = withApiErrors(async function GET(request: Request) {
  const off = await featureGate("ads.creatives");
  if (off) return off;
  if (!(await getMetaAdsConfig())) return notConfigured();
  const preset = datePreset(new URL(request.url).searchParams.get("date_preset"));
  try {
    return NextResponse.json(await creativesReport({ datePreset: preset }));
  } catch (error) {
    return metaFailure(error);
  }
});

export const POST = withApiErrors(async function POST(request: Request) {
  const off = await featureGate("ads.creatives");
  if (off) return off;
  if (!(await getMetaAdsConfig())) return notConfigured();
  if (!(await hasTypesafe())) {
    // The tab never offers the button without a key; this is for anything
    // posting here directly.
    return apiError("not_configured", { field: "TYPESAFE_API_KEY", status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { date_preset?: unknown };
  try {
    return NextResponse.json(await creativesReport({ datePreset: datePreset(body?.date_preset), grade: true }));
  } catch (error) {
    return metaFailure(error);
  }
});
