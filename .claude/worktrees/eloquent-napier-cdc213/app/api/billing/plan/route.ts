import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { nextPeriodEnd, readBillingState, updateBillingState } from "@/lib/billing-store";
import { isPlanId, planMove } from "@/lib/plans";
import { getPlatformStripeKey } from "@/lib/stripe";
import { notSelfServe, readBillingOverview, selfServeBilling } from "@/lib/billing-summary";

// GET  /api/billing/plan — the current plan and any scheduled change.
// POST /api/billing/plan — request a move up or down the ladder.
// DELETE /api/billing/plan — cancel a scheduled downgrade.
//
// Up and down are handled differently on purpose. An upgrade applies now; a
// downgrade is scheduled for the end of the period already paid for, so the
// customer keeps what they bought, and stays cancellable until then.
//
// Only a self-hosted install moves its own plan. On a hosted tenant the fleet
// owns it (lib/hosted.ts), and www.oruka.si sells plans rather than holding
// one: GET says which (lib/billing-summary.ts) and both writes refuse there,
// whatever Stripe is or isn't configured.

export const GET = withApiErrors(async function GET() {
  return NextResponse.json(await readBillingOverview());
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (!selfServeBilling()) return notSelfServe();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = body as { plan?: unknown; reason?: unknown; confirm?: unknown } | null;
  if (!input?.plan) return missingField("plan");
  if (!isPlanId(input.plan)) {
    return apiError("invalid_field", { field: "plan", message: "Unknown plan." });
  }

  const state = await readBillingState();
  const move = planMove(state.plan, input.plan);
  if (move === "current") {
    return apiError("conflict", { message: "That is already the current plan." });
  }

  if (move === "upgrade") {
    // With subscription billing on, a plan is paid for: it lands through
    // /api/billing/checkout and the signed webhook, never through this call.
    // Recording it here would hand out the plan's included credits for free.
    if (getPlatformStripeKey()) {
      return apiError("conflict", {
        message: "Upgrades go through checkout on this installation.",
      });
    }
    const next = await updateBillingState((current) => ({
      ...current,
      plan: input.plan as typeof current.plan,
      periodEnd: current.periodEnd ?? nextPeriodEnd(),
      // An upgrade supersedes a downgrade that had not landed yet: the
      // customer changed their mind in the direction that keeps them.
      pendingChange: null,
    }));
    return NextResponse.json({ ok: true, move, state: next });
  }

  // A downgrade is only accepted with the confirmation the dialog collects.
  // The API enforces it too — the friction is a product decision, not a
  // property of one screen's markup.
  if (input.confirm !== true) {
    return apiError("invalid_field", {
      field: "confirm",
      message: "A downgrade has to be confirmed explicitly.",
    });
  }
  const effectiveAt = state.periodEnd ?? nextPeriodEnd();
  const next = await updateBillingState((current) => ({
    ...current,
    periodEnd: effectiveAt,
    pendingChange: {
      to: input.plan as NonNullable<typeof current.pendingChange>["to"],
      effectiveAt,
      requestedAt: new Date().toISOString(),
      reason: typeof input.reason === "string" ? input.reason : undefined,
    },
  }));
  return NextResponse.json({ ok: true, move, state: next });
});

export const DELETE = withApiErrors(async function DELETE() {
  if (!selfServeBilling()) return notSelfServe();
  const next = await updateBillingState((current) => ({ ...current, pendingChange: null }));
  return NextResponse.json({ ok: true, state: next });
});
