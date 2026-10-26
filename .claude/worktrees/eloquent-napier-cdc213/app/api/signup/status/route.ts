import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { vendorFleetOrigin } from "@/lib/hosted";
import { rateLimit } from "@/lib/rate-limit";

// GET /api/signup/status?session=cs_... — /start/ready polls this while the
// fleet builds the buyer's Oruka (SR-R1). Forwards to the fleet's own status
// endpoint; the session id came back from Stripe in the redirect and is the
// only key. Public under /api/signup in lib/public-paths.ts.

/** A page open for ten minutes polling every few seconds stays well under this. */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 300;
const SESSION = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const fleet = vendorFleetOrigin();
  if (!fleet) return apiError("not_configured");

  const session = request.nextUrl.searchParams.get("session") ?? "";
  if (!SESSION.test(session)) return apiError("invalid_field", { field: "session" });

  const limit = await rateLimit("signup-status", request, { max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!limit.allowed) return apiError("rate_limited");

  try {
    const response = await fetch(`${fleet}/api/signup/status?session=${encodeURIComponent(session)}`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return apiError("upstream_failed");
    const status = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(
      { state: status.state, stage: status.stage, domain: status.domain ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return apiError("upstream_failed");
  }
});
