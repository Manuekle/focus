import { NextResponse } from "next/server";
import { apiFailure, withApiErrors } from "@/lib/api-error";
import { getShopifyConfig, listProducts } from "@/lib/shopify";

// The Shopify catalog for the Catálogo page. Read-only, like the agent's own
// `shopify_products` tool: the products are managed in Shopify, and this is
// where the owner checks what the agent can offer.

export const GET = withApiErrors(async function GET() {
  if (!(await getShopifyConfig())) return NextResponse.json({ connected: false, products: [] });
  try {
    return NextResponse.json({ connected: true, ...(await listProducts()) });
  } catch (error) {
    return apiFailure(error, "upstream_failed");
  }
});
