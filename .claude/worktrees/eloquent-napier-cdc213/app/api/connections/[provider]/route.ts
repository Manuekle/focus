import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { isConnectionId, isManualConnectionId } from "@/lib/connections";
import { clearManualConnection, removeConnection } from "@/lib/connection-store";
import { invalidateProviderReports } from "@/lib/provider-catalog";
import { requireOwner } from "@/lib/owner-gate";
import { probeConnection } from "@/lib/connection-probe";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/connections/<provider> — call the vendor with what is stored and
// say whether it works (lib/connection-probe.ts). On this route rather than a
// new one: it is the same resource, and every route is a function to deploy.
//
// Owner-only, like reading the keys would be, and budgeted: each call is a
// request to the vendor on the account's own key.
export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const denied = await requireOwner(request, "Only the installation owner can test a connection.");
  if (denied) return denied;
  if (!(await rateLimit("connection-probe", request, { max: 20, windowMs: 60_000 })).allowed) {
    return apiError("rate_limited", { status: 429 });
  }
  const { provider } = await context.params;
  if (!isManualConnectionId(provider) && !isConnectionId(provider)) return apiError("not_found");
  const result = await probeConnection(provider);
  if (!result) return apiError("not_found", { message: `Nothing to test for "${provider}".` });
  return NextResponse.json(result);
});

// DELETE /api/connections/<provider> — forget the tokens for one OAuth
// account, or clear the key(s) behind one manual (API-key) connection —
// Anthropic, OpenAI, the AI Gateway, ElevenLabs, Stripe, Meta, Twilio, SMTP.
//
// Local only, and deliberately so: revoking an OAuth grant is the provider's
// own screen, and doing it from here would decide on the operator's behalf
// that a disconnect means a revoke. What this guarantees is that Oruka stops
// holding the token or key.
//
// Owner-only: the keys and tokens are installation-wide, so clearing one
// disconnects every workspace.

export const DELETE = withApiErrors(async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const denied = await requireOwner(request, "Only the installation owner can disconnect an account.");
  if (denied) return denied;

  const { provider } = await context.params;
  if (isManualConnectionId(provider)) {
    await clearManualConnection(provider);
    // Removing a model key changes what the catalog can answer; the cached
    // report would otherwise keep saying the provider is fine for a minute.
    invalidateProviderReports();
    return NextResponse.json({ ok: true });
  }
  if (!isConnectionId(provider)) return apiError("not_found");
  await removeConnection(provider);
  return NextResponse.json({ ok: true });
});
