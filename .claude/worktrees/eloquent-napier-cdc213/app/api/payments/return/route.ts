import { after, type NextRequest, NextResponse } from "next/server";
import { listBusinesses } from "@/lib/business-scope";
import { getCredential } from "@/lib/credentials";
import { deliverPaymentFollowUp } from "@/lib/payment-follow-up";
import { reconcilePayment, type ReconcileHint } from "@/lib/payment-reconcile";
import { listPayments, type PaymentRecord } from "@/lib/payment-store";
import { rateLimit } from "@/lib/rate-limit";
import { getMerchantCheckout } from "@/lib/stripe";
import { withWorkspace } from "@/lib/workspace-context";

// GET /api/payments/return — where Stripe's `after_completion` redirect and
// Mercado Pago's `back_urls` send a buyer right after paying a link the agent
// sent on WhatsApp or Instagram (lib/payments.ts).
//
// Landing here settles the payment, so the buyer is thanked on their channel
// seconds after paying whether or not the operator ever configured the
// webhook. The query string is only a lookup handle: the session or payment it
// names is read back from the processor with the account's own key, and it
// settles a pending link only when the processor says that link was paid in
// full (lib/payment-reconcile.ts). Then the buyer is sent on to app/pay/done,
// which reads the result from the ledger, never from this URL.
//
// Public in middleware.ts: the buyer has no session.

const WORKSPACE = /^[a-zA-Z0-9_-]{1,100}$/;
const STRIPE_SESSION = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const MERCADO_PAGO_PAYMENT = /^\d{1,30}$/;
const REFERENCE = /^oruka_[a-f0-9]{24}$/;

async function findRecord(params: URLSearchParams): Promise<{ record?: PaymentRecord; hint?: ReconcileHint }> {
  const payments = await listPayments();
  if (params.get("provider") === "stripe") {
    const sessionId = params.get("session_id") ?? "";
    const secretKey = await getCredential("STRIPE_SECRET_KEY");
    if (!STRIPE_SESSION.test(sessionId) || !secretKey) return {};
    const session = await getMerchantCheckout(secretKey, sessionId);
    const record = payments.find((payment) => payment.provider === "stripe" && payment.reference === session.payment_link);
    return { record, hint: { stripeSessionId: sessionId } };
  }
  if (params.get("provider") === "mercadopago") {
    const reference = params.get("external_reference") ?? "";
    if (!REFERENCE.test(reference)) return {};
    const record = payments.find((payment) => payment.provider === "mercadopago" && payment.reference === reference);
    const paymentId = params.get("payment_id") || params.get("collection_id") || "";
    return { record, hint: MERCADO_PAGO_PAYMENT.test(paymentId) ? { mercadoPagoPaymentId: paymentId } : undefined };
  }
  return {};
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const done = new URL("/pay/done", request.nextUrl.origin);
  const workspaceId = params.get("ws") ?? "";
  if (!WORKSPACE.test(workspaceId)) return NextResponse.redirect(done, 303);

  const limit = await rateLimit("payment-return", request, { max: 30, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.redirect(done, 303);
  const { businesses } = await listBusinesses();
  if (!businesses.some((business) => business.id === workspaceId)) return NextResponse.redirect(done, 303);

  const reference = await withWorkspace(workspaceId, async () => {
    const { record, hint } = await findRecord(params).catch(() => ({ record: undefined, hint: undefined }));
    if (!record) return undefined;
    if (record.status !== "paid") {
      const outcome = await reconcilePayment(record, hint).catch(() => null);
      if (outcome?.kind === "settled") {
        after(() => withWorkspace(workspaceId, () => deliverPaymentFollowUp(outcome)));
      }
    }
    return record.reference;
  });
  if (reference) {
    done.searchParams.set("ws", workspaceId);
    done.searchParams.set("ref", reference);
  }
  return NextResponse.redirect(done, 303);
}
