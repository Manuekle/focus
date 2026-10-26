import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getConnectionDefinition, isConnectionId } from "@/lib/connections";
import { getClientCredentials, saveConnection } from "@/lib/connection-store";
import { isOwnerRequest } from "@/lib/owner-gate";
import {
  connectionReturnPath,
  exchangeCode,
  exchangeCodeViaFleet,
  redirectUriFor,
  returnCookie,
  stateCookie,
  verifierCookie,
} from "@/lib/oauth-client";

// GET /api/connections/<provider>/callback — where the provider sends the
// browser back.
//
// Every exit from here is a redirect to the Connections page carrying a
// result, because the person is looking at a browser tab, not at JSON. The
// page turns `?connected=` and `?failed=` into a sentence in their language;
// `reason` is only for the detail line and is never shown raw.

function back(request: NextRequest, params: Record<string, string>): NextResponse {
  // The page the flow started from, when that was not Connections. Re-checked
  // against the allowlist: the cookie is this browser's to set.
  const provider = params.connected ?? params.failed;
  const path = connectionReturnPath(provider ? request.cookies.get(returnCookie(provider))?.value : undefined);
  const url = new URL(path, request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  if (provider) response.cookies.delete({ name: returnCookie(provider), path: "/api/connections" });
  return response;
}

export const GET = withApiErrors(async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (!isConnectionId(provider)) return back(request, { failed: "unknown" });

  // Asked again here rather than trusted from the start route: the state
  // cookie is this browser's own to set, so it cannot vouch for who is signed
  // in. Checked before the code is exchanged, so a refused grant is never
  // spent, let alone stored.
  if (!(await isOwnerRequest(request))) {
    const refused = back(request, { failed: provider, reason: "forbidden" });
    refused.cookies.delete({ name: stateCookie(provider), path: "/api/connections" });
    refused.cookies.delete({ name: verifierCookie(provider), path: "/api/connections" });
    return refused;
  }

  const definition = getConnectionDefinition(provider);
  const params = request.nextUrl.searchParams;

  // The consent screen has a Cancel button, and pressing it is not an error
  // worth a red banner.
  const denied = params.get("error");
  if (denied) {
    return back(request, { failed: provider, reason: denied === "access_denied" ? "denied" : "provider" });
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(stateCookie(provider))?.value;
  const verifier = request.cookies.get(verifierCookie(provider))?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return back(request, { failed: provider, reason: "state" });
  }

  const client = await getClientCredentials(provider);
  if (!client) return back(request, { failed: provider, reason: "unconfigured" });

  let result: NextResponse;
  try {
    // A hosted tenant holds no Meta app secret: the fleet trades the Meta Ads
    // code (SEC-4), checking that `state` names this tenant.
    const tokens = client.viaFleet
      ? await exchangeCodeViaFleet({ definition, code, state })
      : await exchangeCode({
          definition,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          code,
          redirectUri: redirectUriFor(request.nextUrl.origin, provider),
          codeVerifier: verifier,
        });
    await saveConnection(provider, tokens);
    result = back(request, { connected: provider });
  } catch {
    result = back(request, { failed: provider, reason: "exchange" });
  }

  // The code is spent either way, so the one-shot cookies go with it.
  result.cookies.delete({ name: stateCookie(provider), path: "/api/connections" });
  result.cookies.delete({ name: verifierCookie(provider), path: "/api/connections" });
  return result;
});
