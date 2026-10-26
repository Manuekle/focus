import { after, type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import { getPayment, verifyMercadoPagoSignature } from "@/lib/mercadopago";
import { settlePaymentAndMarkContact } from "@/lib/payment-settle";
import { deliverPaymentFollowUp } from "@/lib/payment-follow-up";
import { activeBusinessId } from "@/lib/business-scope";
import { withWorkspace } from "@/lib/workspace-context";

// POST /api/webhooks/mercadopago — the operator's Mercado Pago account,
// about a customer who paid a Checkout Pro link the agent sent. The Stripe
// sibling next door does the same job for the other processor.
//
// Two things make this shaped differently from Stripe's:
//
//   The notification carries no payment status, only an id. Mercado Pago's
//   own docs say to read the payment back through the API, which is also the
//   only way to be sure the caller is not simply making the id up.
//
//   The id arrives in the query string (`data.id`), not only in the body, and
//   the signed manifest is built from the query value — so both are read.

type Notification = {
  readonly type?: string;
  readonly topic?: string;
  readonly action?: string;
  readonly data?: { readonly id?: string | number };
};

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const [webhookSecret, accessToken] = await Promise.all([
    getCredential("MERCADOPAGO_WEBHOOK_SECRET"),
    getCredential("MERCADOPAGO_ACCESS_TOKEN"),
  ]);
  // 500 rather than the 200 `not_configured` carries, for the same reason as
  // the Stripe route next door: a notification answered 200 is never resent,
  // and this one could not be acted on.
  if (!webhookSecret) {
    return apiError("server_error", {
      message:
        "Add the Mercado Pago webhook secret in Settings > Mercado Pago before pointing Mercado Pago at this endpoint.",
    });
  }
  if (!accessToken) {
    return apiError("server_error", {
      message: "Add the Mercado Pago access token in Settings — a notification cannot be read back without it.",
    });
  }

  let notification: Notification = {};
  try {
    notification = rawBody ? (JSON.parse(rawBody) as Notification) : {};
  } catch {
    return apiError("invalid_json");
  }

  // The query value is what the signature is computed over; the body's copy
  // is the fallback for the few notification shapes that omit it.
  const dataId =
    request.nextUrl.searchParams.get("data.id") ??
    (notification.data?.id !== undefined ? String(notification.data.id) : null);

  const verified = verifyMercadoPagoSignature({
    signatureHeader: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"),
    dataId,
    secret: webhookSecret,
  });
  if (!verified) {
    return apiError("unauthorized", { message: "Invalid Mercado Pago signature." });
  }

  // Merchant order and plan notifications share this endpoint; only payments
  // settle anything. Acknowledged so they are not retried forever.
  const kind = notification.type ?? notification.topic ?? request.nextUrl.searchParams.get("type");
  if (kind !== "payment" || !dataId) {
    return NextResponse.json({ received: true, settled: false, reason: "not a payment" });
  }

  const payment = await getPayment({ accessToken, paymentId: dataId });
  if (payment.status !== "approved") {
    return NextResponse.json({ received: true, settled: false, reason: payment.status });
  }
  if (!payment.externalReference) {
    return NextResponse.json({ received: true, settled: false, reason: "no external reference" });
  }

  const outcome = await settlePaymentAndMarkContact({
    provider: "mercadopago",
    reference: payment.externalReference,
    amountPaid: payment.amount,
    payerEmail: payment.payerEmail,
    providerPaymentId: payment.id,
  });
  if (outcome.kind === "settled") {
    const workspaceId = await activeBusinessId();
    after(() => withWorkspace(workspaceId, () => deliverPaymentFollowUp(outcome)));
  }

  return NextResponse.json({ received: true, outcome: outcome.kind });
});

export const GET = withApiErrors(function GET() {
  return apiError("method_not_allowed", {
    message: "This endpoint only accepts POST from Mercado Pago.",
  });
});
