import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { vendorFleetOrigin } from "@/lib/hosted";
import { rateLimit } from "@/lib/rate-limit";

// /api/workspaces — find-your-workspace on the vendor site (www.oruka.si).
//
// Hosted customers sign in on their own tenant: its own database and
// accounts, so a sign-in here cannot reach them. /signin asks for the
// address and sends them to its sign-in, or has the fleet email an owner the
// addresses on file. The fleet owns both answers; this route only forwards
// and rate-limits, and refuses on a tenant or a self-hosted install.
//
//   GET  ?name=<address>  -> {found: true, url} | {found: false}
//   POST {email, locale}  -> {ok: true}, the same whether or not it is a customer

const FLEET_TIMEOUT_MS = 10_000;
const FIND_LIMIT = { max: 20, windowMs: 10 * 60_000 } as const;
const REMIND_LIMIT = { max: 5, windowMs: 15 * 60_000 } as const;

/**
 * The fleet only ever sends a visitor to a tenant's sign-in under the fleet's
 * own base domain (fleet.oruka.si -> *.oruka.si). Checked here too, so this
 * route can never become an open redirect.
 */
function isTenantSignIn(url: unknown, fleet: string): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    const base = new URL(fleet).hostname.split(".").slice(1).join(".");
    return parsed.protocol === "https:" && Boolean(base) && parsed.hostname.endsWith(`.${base}`) && parsed.pathname === "/login";
  } catch {
    return false;
  }
}

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const fleet = vendorFleetOrigin();
  if (!fleet) return apiError("not_configured");
  const limit = await rateLimit("workspace-find", request, FIND_LIMIT);
  if (!limit.allowed) return apiError("rate_limited");

  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name || name.length > 200) return apiError("invalid_field", { field: "name" });
  let payload: { found?: unknown; url?: unknown };
  try {
    const response = await fetch(`${fleet}/api/signup/workspace?name=${encodeURIComponent(name)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FLEET_TIMEOUT_MS),
    });
    if (!response.ok) return apiError("upstream_failed");
    payload = (await response.json()) as typeof payload;
  } catch {
    return apiError("upstream_failed");
  }
  return payload.found === true && isTenantSignIn(payload.url, fleet)
    ? NextResponse.json({ found: true, url: payload.url })
    : NextResponse.json({ found: false });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const fleet = vendorFleetOrigin();
  if (!fleet) return apiError("not_configured");
  const limit = await rateLimit("workspace-remind", request, REMIND_LIMIT);
  if (!limit.allowed) return apiError("rate_limited");

  const body = (await request.json().catch(() => null)) as { email?: unknown; locale?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || email.length > 254) return apiError("invalid_field", { field: "email" });
  try {
    const response = await fetch(`${fleet}/api/signup/remind`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, locale: body?.locale === "en" ? "en" : "es" }),
      signal: AbortSignal.timeout(FLEET_TIMEOUT_MS),
    });
    if (response.status === 400) return apiError("invalid_field", { field: "email" });
    if (!response.ok) return apiError("upstream_failed");
  } catch {
    return apiError("upstream_failed");
  }
  return NextResponse.json({ ok: true });
});
