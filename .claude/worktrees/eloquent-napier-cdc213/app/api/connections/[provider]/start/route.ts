import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getConnectionDefinition, isConnectionId } from "@/lib/connections";
import { getClientCredentials } from "@/lib/connection-store";
import { isOwnerRequest } from "@/lib/owner-gate";
import {
  buildAuthorizeUrl,
  challengeFor,
  createState,
  connectionReturnPath,
  createVerifier,
  redirectUriFor,
  returnCookie,
  stateCookie,
  verifierCookie,
} from "@/lib/oauth-client";

// GET /api/connections/<provider>/start — hand the browser to the provider.
//
// This is a navigation, not a fetch: the Connect button is a link, so the
// provider's consent screen opens as a real page on its own domain. Nothing
// about the account is typed into Oruka.
//
// Two one-shot cookies carry the flow across that hop. `state` is what makes
// the callback refuse a code this app didn't ask for, and the PKCE verifier is
// what makes an intercepted code useless to anyone else. Both are httpOnly,
// scoped to /api/connections, and expire in ten minutes.
//
// Only the owner starts one: the account connected here is the one every
// workspace's agent then acts as. A refusal lands on the Connections page
// like any other failed attempt, and the callback asks again — the state
// cookie proves this browser started the flow, not who is signed in to it.

const TEN_MINUTES = 600;

export const GET = withApiErrors(async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  // Both dead ends redirect rather than answering JSON: this URL is opened by
  // a browser, so a raw error body would be the whole screen.
  if (!isConnectionId(provider)) {
    return NextResponse.redirect(new URL("/connections", request.nextUrl.origin));
  }

  if (!(await isOwnerRequest(request))) {
    const url = new URL("/connections", request.nextUrl.origin);
    url.searchParams.set("failed", provider);
    url.searchParams.set("reason", "forbidden");
    return NextResponse.redirect(url);
  }

  const definition = getConnectionDefinition(provider);
  const client = await getClientCredentials(provider);
  if (!client) {
    const url = new URL("/connections", request.nextUrl.origin);
    url.searchParams.set("failed", provider);
    url.searchParams.set("reason", "unconfigured");
    return NextResponse.redirect(url);
  }

  const state = createState();
  const verifier = definition.oauth.pkce ? createVerifier() : undefined;
  const authorizeUrl = buildAuthorizeUrl({
    definition,
    clientId: client.clientId,
    redirectUri: redirectUriFor(request.nextUrl.origin, provider),
    state,
    codeChallenge: verifier ? challengeFor(verifier) : undefined,
    configId: client.configId,
  });

  const response = NextResponse.redirect(authorizeUrl);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/api/connections",
    maxAge: TEN_MINUTES,
  };
  response.cookies.set(stateCookie(provider), state, options);
  if (verifier) response.cookies.set(verifierCookie(provider), verifier, options);
  const returnTo = connectionReturnPath(request.nextUrl.searchParams.get("return"));
  if (returnTo !== "/connections") response.cookies.set(returnCookie(provider), returnTo, options);
  return response;
});
