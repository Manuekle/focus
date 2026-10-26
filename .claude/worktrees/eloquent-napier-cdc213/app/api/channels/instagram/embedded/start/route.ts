import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import { isHosted } from "@/lib/hosted";
import { createState } from "@/lib/oauth-client";
import { requireOwner } from "@/lib/owner-gate";
import {
  IG_LOGIN_SCOPES,
  IG_STATE_COOKIE,
  buildBusinessLoginUrl,
  igEmbeddedCallbackUrl,
} from "@/lib/meta-instagram";

// GET /api/channels/instagram/embedded/start — mint the authorization URL.
//
// Answered as JSON (not a redirect) because the caller is a popup the drawer
// opens with `window.open(url)`: the frontend fetches this, then opens the
// returned URL. A one-shot `state` cookie rides along so the callback refuses
// a code this app didn't ask for. httpOnly, scoped to the instagram channel
// routes, ten minutes.
//
// Owner-only: the token this flow stores is the installation's one Instagram
// account. The callback checks again, because the state cookie only proves
// which browser started the flow.

const TEN_MINUTES = 600;

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const denied = await requireOwner(request, "Only the installation owner can connect Instagram.");
  if (denied) return denied;

  const igAppId = (await getCredential("INSTAGRAM_APP_ID"))?.trim();
  // A hosted tenant's login is finished by the fleet, which holds the secret (SEC-4).
  const igSecret = isHosted() ? "fleet" : (await getCredential("INSTAGRAM_LOGIN_SECRET"))?.trim();
  if (!igAppId || !igSecret) return apiError("not_configured");

  const state = createState();
  const url = buildBusinessLoginUrl({
    igAppId,
    redirectUri: igEmbeddedCallbackUrl(),
    scopes: [...IG_LOGIN_SCOPES],
    state,
  });
  const response = NextResponse.json({ url });
  response.cookies.set(IG_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/channels/instagram",
    maxAge: TEN_MINUTES,
  });
  return response;
});
