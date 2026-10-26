import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { hostedTenant, isFleetRequest } from "@/lib/hosted";
import { heldMetaSecrets } from "@/lib/hosted-meta-settings";
import { applyRuntimeConfig, readRuntimeConfig } from "@/lib/tenant-config";

// /api/fleet/config — the tenant's runtime configuration (lib/tenant-config.ts).
//
//   POST {version, plan, access?, announcements?, features?}
//                         the fleet hands over the configuration it holds for
//                         this tenant: on a plan change, from its sweep until
//                         confirmed, and once while provisioning. `access`
//                         (beta | subscription) only labels the billing page;
//                         `announcements` are what the operator announces to
//                         this tenant (lib/announcements.ts); `features` the
//                         operator's on/off per feature (lib/features.ts);
//                         `test: true` marks the operator's test tenant, the
//                         only one /api/fleet/fixture loads demo data into.
//                         `200 {version, plan}` with what is stored now (also
//                         for a repeat); `409 stale` for a version older.
//   GET                   what is stored, and which Meta app secrets this
//                         deployment holds (names only, SEC-4), for the
//                         operator's diagnostics (`pnpm fleet status`).
//
// Fleet token only; 404 for anyone else and on self-hosted installs. Takes
// effect on the next read: no deployment. Contract: docs/hosted-fleet-contract.md.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  const config = await readRuntimeConfig();
  // SEC-4: which Meta app secrets this deployment still holds, by name only,
  // so `pnpm fleet status` can tell a withheld tenant from one not rebuilt yet.
  const metaSecrets = heldMetaSecrets();
  return NextResponse.json(
    config ? { version: config.version, plan: config.plan, appliedAt: config.appliedAt, metaSecrets } : { version: null, metaSecrets },
  );
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  const body = (await request.json().catch(() => null)) as
    | { version?: unknown; plan?: unknown; access?: unknown; announcements?: unknown; features?: unknown; test?: unknown }
    | null;
  const result = await applyRuntimeConfig(body ?? {});
  if (!result.ok) {
    if (result.reason === "invalid") return apiError("invalid_body", { message: "version (integer >= 1) and plan (pro, managed or none) are required." });
    return NextResponse.json(
      { error: "stale", code: "stale", version: result.current?.version, plan: result.current?.plan },
      { status: 409 },
    );
  }
  if (result.changed) {
    console.log(
      JSON.stringify({ event: "billing.plan.changed", tenantId: hostedTenant()?.id ?? null, plan: result.config.plan, version: result.config.version }),
    );
  }
  return NextResponse.json({ version: result.config.version, plan: result.config.plan });
});
