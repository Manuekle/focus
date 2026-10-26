import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { FleetCallError, postToFleet, runtimeMode } from "@/lib/hosted";
import { requireOwner } from "@/lib/owner-gate";

// POST /api/billing/portal `{locale?}` — a one-time link into the Stripe
// customer portal for this hosted tenant's subscription: pay an open
// invoice, change the card, download invoices, cancel. The fleet owns the
// Stripe customer and opens the session (oruka-fleet src/billing/portal.ts);
// this only asks for it, as the tenant, and only for the installation owner,
// who holds the subscription. The portal returns to /account/billing.
//
//   409 conflict   nothing is billed yet (a private-beta tenant)
//   403 forbidden  not the owner, or an install the fleet does not bill

export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (runtimeMode() !== "tenant") {
    return apiError("forbidden", { message: "Only a hosted installation pays through the Oruka billing portal." });
  }
  const denied = await requireOwner(request, "Only the installation owner can manage billing.");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = body?.locale === "en" ? "en" : "es";
  try {
    const { url } = await postToFleet<{ url?: string }>("/api/tenants/billing", { action: "portal", locale });
    if (typeof url !== "string" || !url.startsWith("https://billing.stripe.com/")) {
      return apiError("upstream_failed", { message: "The billing portal did not answer with a link." });
    }
    return NextResponse.json({ url });
  } catch (error) {
    if (!(error instanceof FleetCallError)) throw error;
    if (error.status === 409) return apiError("conflict", { message: "There is no subscription to manage yet.", detail: "no_customer" });
    if (error.code === "not_configured") return apiError("not_configured", { status: 503 });
    return apiError("upstream_failed", { message: "The billing portal could not be opened. Try again in a moment." });
  }
});
