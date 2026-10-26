import { after, type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import { getShopifyConfig, ORUKA_ORDER_ATTRIBUTE, verifyShopifyWebhook } from "@/lib/shopify";
import { settlePaymentAndMarkContact } from "@/lib/payment-settle";
import { deliverPaymentFollowUp } from "@/lib/payment-follow-up";
import { activeBusinessId } from "@/lib/business-scope";
import { withWorkspace } from "@/lib/workspace-context";

// POST /api/webhooks/shopify — the operator's store reporting that an order
// was paid.
//
// Only orders that started as a cart the agent built carry the `oruka_ref`
// note attribute (lib/shopify.ts → buildCartPermalink); that reference is the
// payment ledger entry shopify_checkout wrote, and settling it is what marks
// the contact and thanks the buyer. Every other order on the store is
// acknowledged and ignored.
//
// Public in middleware: Shopify carries no session. The HMAC-SHA256 of the raw
// body, base64, in X-Shopify-Hmac-Sha256, with the secret from Settings, is the
// auth — and the shop domain header has to be the store this install is
// connected to, so a valid signature from some other shop settles nothing.

type ShopifyOrder = {
  readonly id?: number;
  readonly email?: string;
  readonly total_price?: string;
  readonly financial_status?: string;
  readonly note_attributes?: ReadonlyArray<{ readonly name?: string; readonly value?: string }>;
};

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const secret = await getCredential("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) {
    // 500 so Shopify retries while the operator is still pasting the secret;
    // it retries a failed delivery for 48 hours.
    return apiError("server_error", {
      message: "Add the Shopify webhook secret in Settings > Shopify before pointing Shopify at this endpoint.",
    });
  }
  if (!verifyShopifyWebhook(rawBody, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return apiError("unauthorized", { message: "Invalid Shopify signature." });
  }

  const config = await getShopifyConfig();
  const shopHeader = request.headers.get("x-shopify-shop-domain")?.toLowerCase();
  if (!config || (shopHeader && shopHeader !== config.shop.toLowerCase())) {
    return NextResponse.json({ received: true, settled: false, reason: "other shop" });
  }

  if (request.headers.get("x-shopify-topic") !== "orders/paid") {
    return NextResponse.json({ received: true });
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return apiError("invalid_json");
  }
  const reference = order.note_attributes?.find((attribute) => attribute.name === ORUKA_ORDER_ATTRIBUTE)?.value;
  if (!reference) {
    return NextResponse.json({ received: true, settled: false, reason: "not an agent cart" });
  }

  const outcome = await settlePaymentAndMarkContact({
    provider: "shopify",
    reference,
    ...(order.total_price ? { amountPaid: order.total_price } : {}),
    ...(order.email ? { payerEmail: order.email } : {}),
    ...(order.id ? { providerPaymentId: String(order.id) } : {}),
  });
  if (outcome.kind === "settled") {
    const workspaceId = await activeBusinessId();
    after(() => withWorkspace(workspaceId, () => deliverPaymentFollowUp(outcome)));
  }
  return NextResponse.json({ received: true, outcome: outcome.kind });
});

export const GET = withApiErrors(function GET() {
  return apiError("method_not_allowed", {
    message: "This endpoint only accepts POST from Shopify.",
  });
});
