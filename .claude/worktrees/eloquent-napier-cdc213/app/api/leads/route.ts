import { getCredential } from "@/lib/credentials";
import { intakeLead } from "@/lib/lead-intake";
import type { LeadInput } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { listBusinesses } from "@/lib/business-scope";
import { withWorkspace } from "@/lib/workspace-context";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * The secret is required, not optional.
 *
 * This route is public in middleware.ts — a lead form or a third-party
 * dashboard has no session cookie to send — and it writes contacts, opens
 * chats and fires automations that message people over WhatsApp. Treating a
 * missing secret as "open" made an unconfigured install an open relay for all
 * of that, so an install without one now refuses every call and says why.
 */
async function verifySecret(request: NextRequest): Promise<"ok" | "not_configured" | "denied"> {
  const secret = (await getCredential("LEAD_WEBHOOK_SECRET"))?.trim();
  if (!secret) return "not_configured";
  const provided = request.headers.get("x-webhook-secret");
  if (!provided) return "denied";
  return timingSafeEqual(provided, secret) ? "ok" : "denied";
}

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const auth = await verifySecret(request);
  if (auth === "not_configured") {
    // 401, not the 200 that `not_configured` carries: the caller must see
    // this as a rejected delivery and retry once the secret exists.
    return apiError("unauthorized", {
      message:
        "Set a lead webhook secret in Settings > Integrations, then send it as the x-webhook-secret header.",
    });
  }
  if (auth === "denied") {
    return apiError("unauthorized");
  }

  // The most public write in the app: intake creates contacts, opens chats
  // and fires automations that message people. A secret that leaks must not
  // mean unlimited writes, so the budget is per address on the same shared
  // limiter the automation webhook uses.
  if (!(await rateLimit("public-webhook", request, { max: 30, windowMs: 10 * 60_000 })).allowed) {
    return apiError("rate_limited");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }

  const deliveryId = request.headers.get("Idempotency-Key")?.trim();
  if (deliveryId && (deliveryId.length > 200 || !/^[\x21-\x7e]+$/.test(deliveryId))) {
    return apiError("invalid_field", { field: "Idempotency-Key" });
  }
  const requestedWorkspace = request.headers.get("x-workspace-id")?.trim();
  const businesses = (await listBusinesses()).businesses.filter((item) => item.access !== "suspended");
  const workspaceId = requestedWorkspace || (businesses.length === 1 ? businesses[0].id : undefined);
  if (!workspaceId || !businesses.some((item) => item.id === workspaceId)) {
    return apiError("invalid_field", {
      field: "x-workspace-id",
      message: "Set x-workspace-id to an accessible business ID when receiving leads for multiple businesses.",
    });
  }
  const contact = await withWorkspace(workspaceId, () => intakeLead(body as LeadInput, deliveryId));

  return NextResponse.json({ ok: true, contact });
});

// A public webhook URL gets opened in a browser sooner or later. Answering the
// framework's bare 405 leaves the person staring at an empty page; this says
// the endpoint is alive and what it wants instead.
export const GET = withApiErrors(async function GET(request: NextRequest) {
  // Browsers land here by pasting the URL; the budget also stops the GET from
  // being the cheap probe that maps which webhook URLs answer what.
  if (!(await rateLimit("public-webhook", request, { max: 30, windowMs: 10 * 60_000 })).allowed) {
    return apiError("rate_limited");
  }
  return apiError("method_not_allowed", {
    message: "This endpoint only accepts POST from your lead form or webhook.",
  });
});
