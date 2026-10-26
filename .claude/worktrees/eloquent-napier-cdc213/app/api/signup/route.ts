import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { vendorFleetOrigin } from "@/lib/hosted";
import { salesOpen } from "@/lib/sales";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/signup — the pricing page's "Suscribirse" for a hosted plan
// (SR-R1). Asks the oruka-fleet control plane (ORUKA_FLEET_URL) for the
// buyer's Stripe Payment Link: the fleet checks the subdomain is free before
// anyone pays, and the link carries it to the checkout. After payment the
// fleet provisions the tenant on its own. Public in lib/public-paths.ts.
//
// No honeypot: browsers and password managers autofill hidden "website"
// fields, and here a false positive refused a real buyer with "check the
// email". The answer is a public Payment Link anyway; the rate limit is the
// guard.

const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX = 10;
const FLEET_TIMEOUT_MS = 10_000;

/** The only place a buyer is ever sent: Stripe's own Payment Link host. */
const PAYMENT_HOST = "buy.stripe.com";

type SignupBody = {
  readonly slug?: unknown;
  readonly email?: unknown;
  readonly plan?: unknown;
  readonly period?: unknown;
};

export const POST = withApiErrors(async function POST(request: NextRequest) {
  // Only the vendor install sells: a hosted tenant is a customer's install,
  // not a shop for more of them (lib/hosted.ts runtimeMode).
  const fleet = vendorFleetOrigin();
  if (!fleet) return apiError("not_configured");
  // Private beta: no Payment Link until the operator opens sales (lib/sales.ts).
  if (!salesOpen()) return apiError("not_configured");

  const limit = await rateLimit("signup", request, { max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!limit.allowed) return apiError("rate_limited");

  let body: SignupBody;
  try {
    body = (await request.json()) as SignupBody;
  } catch {
    return apiError("invalid_json");
  }

  const payload = {
    slug: typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "",
    email: typeof body.email === "string" ? body.email.trim() : "",
    plan: body.plan === "managed" ? "managed" : body.plan === "pro" ? "pro" : "",
    period: body.period === "annual" ? "annual" : "monthly",
  };

  let response: Response;
  try {
    response = await fetch(`${fleet}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FLEET_TIMEOUT_MS),
    });
  } catch {
    return apiError("upstream_failed");
  }
  const answer = (await response.json().catch(() => null)) as { url?: unknown; field?: unknown } | null;

  if (response.status === 409) return apiError("conflict", { field: "slug" });
  if (response.status === 400) {
    const field = answer?.field === "email" || answer?.field === "plan" || answer?.field === "period" ? answer.field : "slug";
    return apiError("invalid_field", { field });
  }
  if (!response.ok || typeof answer?.url !== "string") return apiError("upstream_failed");
  try {
    if (new URL(answer.url).host !== PAYMENT_HOST) return apiError("upstream_failed");
  } catch {
    return apiError("upstream_failed");
  }
  return NextResponse.json({ url: answer.url });
});
