import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getInstallationId } from "@/lib/license/installation";
import { getCurrentLicenseInfo } from "@/lib/license/store";
import { getAccount } from "@/lib/credit-account";
import { readBillingState } from "@/lib/billing-store";

// GET /api/credits/balance — the credits bar at the top of Settings → AI
// Usage. Enterprise gets a distinct shape from Pro/Managed: it never carries
// included credits (self-hosted + BYOK by design — see lib/credit-gate.ts),
// so there is no "X / Y credits" to show, only that usage is metered without
// a limit Oruka imposes.

export const GET = withApiErrors(async function GET() {
  const [organizationId, license, billing] = await Promise.all([
    getInstallationId(),
    getCurrentLicenseInfo(),
    readBillingState(),
  ]);

  const isEnterprise = license.status === "valid" && license.payload?.edition === "enterprise";
  if (isEnterprise) {
    return NextResponse.json({ metered: true, unlimited: true, plan: "enterprise" as const });
  }

  const account = await getAccount(organizationId);
  return NextResponse.json({
    metered: true,
    unlimited: false,
    plan: billing.plan,
    balance: account.balance,
    monthlyAllocation: account.monthlyAllocation,
    usedThisPeriod: account.usedThisPeriod,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    hasIncludedCredits: account.hasIncludedCredits,
  });
});
