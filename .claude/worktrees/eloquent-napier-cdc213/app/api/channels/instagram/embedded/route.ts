import { NextResponse } from "next/server";
import { isHosted } from "@/lib/hosted";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential, saveCredentials } from "@/lib/credentials";
import {
  IG_LOGIN_SCOPES,
  igEmbeddedCallbackUrl,
  refreshLongLivedToken,
} from "@/lib/meta-instagram";
import { MetaApiError } from "@/lib/meta-ads";
import { requireOwner } from "@/lib/owner-gate";
import { disconnectChannel } from "@/lib/channel-disconnect";

// Instagram Business Login (one-click connect).
//
// GET answers what the browser needs to open Meta's authorization window:
// the Instagram App ID, the registered redirect URI, and the scopes. The
// Instagram App Secret never crosses this line — the code exchange happens
// in the callback route, server-side (at the fleet, on a hosted tenant).
//
// POST { action: "refresh" } rolls the stored long-lived token (60-day
// expiry) for another 60 days. Reconnecting through the popup does the same
// thing, but a quiet refresh keeps the channel alive without another login.

export const GET = withApiErrors(async function GET() {
  const hosted = isHosted();
  const igAppId = (await getCredential("INSTAGRAM_APP_ID"))?.trim();
  // A hosted tenant holds no Instagram secret: the fleet finishes its login (SEC-4).
  const igSecret = hosted ? undefined : (await getCredential("INSTAGRAM_LOGIN_SECRET"))?.trim();
  const connected = Boolean(
    (await getCredential("INSTAGRAM_ACCESS_TOKEN"))?.trim() &&
      (await getCredential("INSTAGRAM_ACCOUNT_ID"))?.trim(),
  );
  const verifyTokenConfigured = Boolean((await getCredential("INSTAGRAM_VERIFY_TOKEN"))?.trim());
  const username = connected ? (await getCredential("INSTAGRAM_USERNAME"))?.trim() : undefined;
  return NextResponse.json({
    configured: Boolean(igAppId && (hosted || igSecret)),
    ...(igAppId ? { igAppId } : {}),
    redirectUri: igEmbeddedCallbackUrl(),
    scopes: [...IG_LOGIN_SCOPES],
    connected,
    ...(username ? { username } : {}),
    verifyTokenConfigured,
    // Hosted: Oruka operates the Meta app, redirect URIs and webhooks, so
    // the drawer hides those operator steps from the customer.
    hosted,
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  // Rewrites the stored token: owner-only, like the connect it renews.
  const denied = await requireOwner(request, "Only the installation owner can refresh the Instagram token.");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if ((body as { action?: unknown } | null)?.action !== "refresh") {
    return apiError("invalid_body");
  }
  const current = (await getCredential("INSTAGRAM_ACCESS_TOKEN"))?.trim();
  if (!current) return apiError("not_configured");
  try {
    const refreshed = await refreshLongLivedToken({ longToken: current });
    await saveCredentials({
      INSTAGRAM_ACCESS_TOKEN: refreshed.accessToken,
      INSTAGRAM_TOKEN_REFRESHED_AT: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      ...(typeof refreshed.expiresIn === "number" ? { expiresIn: refreshed.expiresIn } : {}),
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      return apiError("upstream_failed", { message: error.message });
    }
    throw error;
  }
});

// DELETE — disconnect Instagram: the account's credentials are removed and the
// webhook answers `channel_not_configured` from the next delivery. A
// configuration change only: no restart and no rebuild (lib/channel-disconnect.ts).
export const DELETE = withApiErrors(async function DELETE(request: Request) {
  const denied = await requireOwner(request, "Only the installation owner can disconnect Instagram.");
  if (denied) return denied;
  const result = await disconnectChannel("instagram");
  return NextResponse.json({ ok: true, warnings: result.warnings });
});
