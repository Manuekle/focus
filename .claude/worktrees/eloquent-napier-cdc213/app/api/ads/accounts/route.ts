import { NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { getClientCredentials } from "@/lib/connection-store";
import { getCredential } from "@/lib/credentials";
import {
  getMetaAdsToken,
  listMetaAssets,
  MetaApiError,
  MetaSelectionError,
  selectMetaAssets,
} from "@/lib/meta-ads";
import { requireOwner } from "@/lib/owner-gate";

export const dynamic = "force-dynamic";

// GET  /api/ads/accounts — how Meta is connected and what it can reach
// POST /api/ads/accounts — { adAccountId, pageId? }: choose what Ads works on
//
// The picker behind the Ads page. A Meta login shares a token; which ad
// account and Page the page and the agent act on is chosen here and stored
// in the same keys a pasted token uses.

export const GET = withApiErrors(async function GET() {
  const [token, client, adAccountId, pageId] = await Promise.all([
    getMetaAdsToken(),
    getClientCredentials("meta"),
    getCredential("META_AD_ACCOUNT_ID"),
    getCredential("META_PAGE_ID"),
  ]);
  const base = {
    // Whether a "Connect Meta" button can work on this install: the Meta app
    // and its login configuration are set (always, on hosted).
    oauthAvailable: Boolean(client),
    source: token?.source ?? null,
    selected: { adAccountId: adAccountId ?? null, pageId: pageId ?? null },
  };
  if (!token) return NextResponse.json({ ...base, adAccounts: [], pages: [] });
  try {
    const assets = await listMetaAssets();
    return NextResponse.json({ ...base, adAccounts: assets?.adAccounts ?? [], pages: assets?.pages ?? [] });
  } catch (error) {
    if (error instanceof MetaApiError) return apiError("upstream_failed", { detail: error.message });
    throw error;
  }
});

export const POST = withApiErrors(async function POST(request: Request) {
  const refused = await requireOwner(request);
  if (refused) return refused;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError("invalid_json");
  }
  const adAccountId = typeof body.adAccountId === "string" ? body.adAccountId.trim() : "";
  if (!adAccountId) return missingField("adAccountId");
  const pageId = typeof body.pageId === "string" && body.pageId.trim() ? body.pageId.trim() : null;

  try {
    await selectMetaAssets({ adAccountId, pageId });
  } catch (error) {
    if (error instanceof MetaSelectionError) return apiError("invalid_field", { field: error.field });
    throw error;
  }
  return NextResponse.json({ ok: true });
});
