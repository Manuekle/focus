import { NextResponse } from "next/server";
import {
  apiError,
  apiErrorBody,
  missingField,
  withApiErrors,
} from "@/lib/api-error";
import {
  autoSelectMetaAssets,
  getMetaAdsConfig,
  getMetaAdsToken,
  getCampaigns,
  getCampaignInsightsMap,
  getLeads,
  getLeadForms,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  CAMPAIGN_OBJECTIVES,
  SPECIAL_AD_CATEGORIES,
  WRITABLE_STATUSES,
  type CampaignObjective,
  type SpecialAdCategory,
  type WritableStatus,
} from "@/lib/meta-ads";
import { metaFailure } from "@/lib/meta-ads-failure";
import { isOwnerRequest } from "@/lib/owner-gate";

export const dynamic = "force-dynamic";

// GET    /api/ads?tab=campaigns&date_preset=last_30d — campaigns + insights
// GET    /api/ads?tab=leads                         — leads + their forms
// POST   /api/ads                                   — create a campaign (PAUSED)
// PATCH  /api/ads                                   — rename / re-budget / pause / resume
// DELETE /api/ads?id=<campaign_id>                  — delete a campaign

/** The reply for an install with no Meta keys. Deliberately a 200: an install
 *  without credentials is a normal state, and answering 400 made every page
 *  load log a failure nothing could fix.
 *
 *  `field: "adAccountId"` is the half-way state: Meta is connected, but the
 *  login shared more than one ad account and none is chosen yet, so the page
 *  shows the account picker instead of the connect button. */
async function notConfigured() {
  const token = await getMetaAdsToken();
  return NextResponse.json(
    apiErrorBody("not_configured", {
      message: token
        ? "Meta is connected, but no ad account is chosen yet."
        : "Meta Ads isn't connected. Connect Meta in Connections, or set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in Settings.",
      ...(token ? { field: "adAccountId" } : {}),
    }),
    { status: 200 },
  );
}

/** The configuration, choosing the ad account on the way when a fresh Meta
 *  login shared exactly one — the common case needs no picker at all. Only
 *  for the owner: choosing writes the installation's credential store. */
async function resolveConfig(request: Request) {
  const config = await getMetaAdsConfig();
  if (config) return config;
  if (!(await getMetaAdsToken()) || !(await isOwnerRequest(request))) return null;
  const chosen = await autoSelectMetaAssets().catch(() => false);
  return chosen ? getMetaAdsConfig() : null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A budget as a person typed it (major units — pesos, dollars) turned into the
 * minor units Meta speaks.
 *
 * `undefined` means "not in this request"; `null` means "present and unusable",
 * which the caller answers with `invalid_field` rather than silently dropping.
 * A budget quietly ignored is a campaign running on the wrong number.
 */
function toMinorUnits(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const major = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 100);
}

export const GET = withApiErrors(async function GET(request: Request) {
  const config = await resolveConfig(request);
  if (!config) return notConfigured();

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "campaigns";
  const datePreset = url.searchParams.get("date_preset") ?? "last_30d";

  try {
    if (tab === "campaigns") {
      // One insights call for the whole account rather than one per campaign.
      // Keyed by campaign id, not positional: the page paginates, so an array
      // aligned to the *unpaginated* list put page two's numbers on page
      // one's rows.
      const [campaigns, insights] = await Promise.all([
        getCampaigns(),
        getCampaignInsightsMap(datePreset).catch(() => ({})),
      ]);
      return NextResponse.json({ campaigns, insights });
    }

    if (tab === "leads") {
      // Lead forms live on the Page. Without one connected there is nothing to
      // read, and that is a missing setting rather than a failure — the page
      // says so instead of showing an error.
      if (!config.pageId) {
        return NextResponse.json({ leads: [], forms: [], pageMissing: true });
      }
      const forms = await getLeadForms();
      const leads = await getLeads(forms.map((form) => form.id));
      return NextResponse.json({ leads, forms });
    }

    return apiError("invalid_field", { field: "tab" });
  } catch (err) {
    return metaFailure(err);
  }
});

export const POST = withApiErrors(async function POST(request: Request) {
  if (!(await getMetaAdsConfig())) return notConfigured();

  const body = await readJson(request);
  if (!body) return apiError("invalid_json");

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return missingField("name");

  const objective = body.objective;
  if (!CAMPAIGN_OBJECTIVES.includes(objective as CampaignObjective)) {
    return apiError("invalid_field", { field: "objective" });
  }

  const daily = toMinorUnits(body.dailyBudget);
  if (daily === null) return apiError("invalid_field", { field: "dailyBudget" });
  const lifetime = toMinorUnits(body.lifetimeBudget);
  if (lifetime === null) return apiError("invalid_field", { field: "lifetimeBudget" });
  // Meta rejects a campaign carrying both, with a message about budget
  // scheduling that does not name the real problem. Refusing here says it.
  if (daily !== undefined && lifetime !== undefined) {
    return apiError("invalid_field", { field: "dailyBudget" });
  }

  const rawCategories = Array.isArray(body.specialAdCategories) ? body.specialAdCategories : [];
  const categories = rawCategories.filter((c): c is SpecialAdCategory =>
    SPECIAL_AD_CATEGORIES.includes(c as SpecialAdCategory),
  );
  if (categories.length !== rawCategories.length) {
    return apiError("invalid_field", { field: "specialAdCategories" });
  }

  try {
    // Always created PAUSED — see `createCampaign`. Going live is a second,
    // deliberate act through PATCH.
    const created = await createCampaign({
      name,
      objective: objective as CampaignObjective,
      ...(daily !== undefined ? { dailyBudgetMinor: daily } : {}),
      ...(lifetime !== undefined ? { lifetimeBudgetMinor: lifetime } : {}),
      specialAdCategories: categories,
    });
    return NextResponse.json({ id: created.id, status: "PAUSED" }, { status: 201 });
  } catch (err) {
    return metaFailure(err);
  }
});

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  if (!(await getMetaAdsConfig())) return notConfigured();

  const body = await readJson(request);
  if (!body) return apiError("invalid_json");

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return missingField("id");

  const patch: {
    name?: string;
    status?: WritableStatus;
    dailyBudgetMinor?: number;
    lifetimeBudgetMinor?: number;
  } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError("invalid_field", { field: "name" });
    patch.name = name;
  }

  if (body.status !== undefined) {
    if (!WRITABLE_STATUSES.includes(body.status as WritableStatus)) {
      // ARCHIVED and DELETED are not status edits — DELETE has its own verb.
      return apiError("invalid_field", { field: "status" });
    }
    patch.status = body.status as WritableStatus;
  }

  const daily = toMinorUnits(body.dailyBudget);
  if (daily === null) return apiError("invalid_field", { field: "dailyBudget" });
  if (daily !== undefined) patch.dailyBudgetMinor = daily;

  const lifetime = toMinorUnits(body.lifetimeBudget);
  if (lifetime === null) return apiError("invalid_field", { field: "lifetimeBudget" });
  if (lifetime !== undefined) patch.lifetimeBudgetMinor = lifetime;

  if (Object.keys(patch).length === 0) return apiError("nothing_to_update");

  try {
    await updateCampaign(id, patch);
    return NextResponse.json({ success: true });
  } catch (err) {
    return metaFailure(err);
  }
});

export const DELETE = withApiErrors(async function DELETE(request: Request) {
  if (!(await getMetaAdsConfig())) return notConfigured();

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return missingField("id");

  try {
    // Meta moves the campaign — and every ad set and ad under it — to status
    // DELETED. Delivery and spend stop; past reporting survives. There is no
    // undo through the API.
    await deleteCampaign(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return metaFailure(err);
  }
});
