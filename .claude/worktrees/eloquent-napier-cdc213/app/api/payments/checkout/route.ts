import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, withApiErrors } from "@/lib/api-error";
import { requireOwner } from "@/lib/owner-gate";
import { activeBusinessId } from "@/lib/business-scope";
import { getCredential } from "@/lib/credentials";
import {
  listPayments,
  rememberStripeCheckout,
  reserveStripeCheckout,
  type PaymentRecord,
} from "@/lib/payment-store";
import {
  createMerchantCheckout,
  getMerchantCheckout,
  toSmallestUnit,
  type MerchantCheckoutSession,
} from "@/lib/stripe";
import { rateLimit } from "@/lib/rate-limit";
import { reconcilePayment, type ReconcileHint } from "@/lib/payment-reconcile";
import { deliverPaymentFollowUp } from "@/lib/payment-follow-up";
import { withWorkspace } from "@/lib/workspace-context";

const inputSchema = z
  .object({ checkoutUrl: z.string().url().max(2048) })
  .strict();
const noStore = { "cache-control": "private, no-store" };

function details(payment: PaymentRecord) {
  return {
    productName: payment.productName,
    amount: payment.amount,
    currency: payment.currency,
  };
}

function matches(
  session: MerchantCheckoutSession,
  payment: PaymentRecord,
  workspaceId: string,
) {
  return (
    session.metadata.oruka_workspace_id === workspaceId &&
    session.metadata.oruka_payment_reference === payment.reference &&
    session.currency.toLowerCase() === payment.currency.toLowerCase() &&
    session.amount_total === toSmallestUnit(payment.amount, payment.currency)
  );
}

/**
 * Settle a payment the processor confirmed, instead of waiting for a webhook
 * the operator may not have configured, and thank the buyer the way the
 * webhook would. Never throws: the answer to the browser is the processor's.
 */
async function settle(
  payment: PaymentRecord,
  workspaceId: string,
  hint?: ReconcileHint,
): Promise<boolean> {
  try {
    const outcome = await reconcilePayment(payment, hint);
    if (outcome?.kind === "settled")
      after(() =>
        withWorkspace(workspaceId, () => deliverPaymentFollowUp(outcome)),
      );
    return outcome !== null;
  } catch {
    return false;
  }
}

async function respond(
  request: NextRequest,
  create: boolean,
): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  if (create && request.headers.get("origin") !== request.nextUrl.origin)
    return apiError("forbidden");
  const limit = await rateLimit("payment-checkout", request, {
    max: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    const response = apiError("rate_limited");
    for (const [key, value] of Object.entries(limit.headers))
      response.headers.set(key, value);
    return response;
  }

  let raw: unknown;
  try {
    raw = create
      ? await request.json()
      : { checkoutUrl: request.nextUrl.searchParams.get("checkoutUrl") };
  } catch {
    return apiError("invalid_json");
  }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return apiError("invalid_body");

  // Only a saved payment in the authorized request workspace can be checked out.
  // Browser/tool output supplies a lookup handle, never a price or a Stripe session id.
  // Mercado Pago pays on its own page; here it only answers whether it did.
  let payment = (await listPayments()).find(
    (record) =>
      (record.provider === "stripe" ||
        (!create && record.provider === "mercadopago")) &&
      record.checkoutUrl === parsed.data.checkoutUrl,
  );
  if (!payment) return apiError("not_found");
  if (payment.status === "paid")
    return NextResponse.json(
      { status: "paid", ...details(payment) },
      { headers: noStore },
    );

  const workspaceId = await activeBusinessId();
  if (payment.provider === "mercadopago") {
    const paid = await settle(payment, workspaceId);
    return NextResponse.json(
      { status: paid ? "paid" : "pending", ...details(payment) },
      { headers: noStore },
    );
  }
  if (create) {
    const creationLimit = await rateLimit(
      "payment-checkout-create",
      workspaceId,
      { max: 20, windowMs: 60_000 },
    );
    if (!creationLimit.allowed) return apiError("rate_limited");
  }
  const secretKey = await getCredential("STRIPE_SECRET_KEY");
  const publishableKey = await getCredential("STRIPE_PUBLISHABLE_KEY");
  if (
    !secretKey ||
    (create &&
      (!publishableKey ||
        !/^pk_(test|live)_/.test(publishableKey) ||
        secretKey.startsWith("sk_test_") !==
          publishableKey.startsWith("pk_test_")))
  ) {
    return apiError("not_configured", { status: 503 });
  }

  try {
    let session: MerchantCheckoutSession | undefined;
    if (payment.stripeCheckout?.sessionId) {
      session = await getMerchantCheckout(
        secretKey,
        payment.stripeCheckout.sessionId,
      );
      if (!matches(session, payment, workspaceId)) return apiError("conflict");
      if (session.payment_status === "paid") {
        await settle(payment, workspaceId, { stripeSessionId: session.id });
        return NextResponse.json(
          { status: "paid", ...details(payment) },
          { headers: noStore },
        );
      }
      if (session.status === "complete") {
        return NextResponse.json(
          { status: "processing", ...details(payment) },
          { headers: noStore },
        );
      }
    }
    // Paid through the link itself (copied out of the chat): Stripe knows,
    // and asking it is what settles the payment without a webhook.
    if (!create)
      return NextResponse.json(
        {
          status: (await settle(payment, workspaceId)) ? "paid" : "pending",
          ...details(payment),
        },
        { headers: noStore },
      );
    if (!session || session.status === "expired") {
      const reserved = await reserveStripeCheckout(
        payment.reference,
        session?.id,
      );
      if (!reserved) return apiError("not_found");
      payment = reserved;
      if (payment.status === "paid")
        return NextResponse.json(
          { status: "paid", ...details(payment) },
          { headers: noStore },
        );
      const attempt = payment.stripeCheckout!.attempt;
      session = await createMerchantCheckout({
        secretKey,
        ...details(payment),
        reference: payment.reference,
        workspaceId,
        attempt,
      });
      await rememberStripeCheckout(payment.reference, attempt, session.id);
    }
    if (!matches(session, payment, workspaceId) || !session.client_secret)
      return apiError("upstream_failed");
    return NextResponse.json(
      {
        status: "ready",
        ...details(payment),
        clientSecret: session.client_secret,
        publishableKey,
        testMode: !session.livemode,
      },
      { headers: noStore },
    );
  } catch {
    return apiError("upstream_failed");
  }
}

export const POST = withApiErrors((request: NextRequest) =>
  respond(request, true),
);
export const GET = withApiErrors((request: NextRequest) =>
  respond(request, false),
);
