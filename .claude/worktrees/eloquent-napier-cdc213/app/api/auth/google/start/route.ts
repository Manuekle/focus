import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import { GOOGLE_LOGIN_OAUTH } from "@/lib/google-login-oauth";
import {
  buildAuthorizeUrl,
  challengeFor,
  createState,
  createVerifier,
  googleLoginRedirectUri,
  nextCookie,
  stateCookie,
  verifierCookie,
} from "@/lib/oauth-client";
import { safeNextPath } from "@/lib/safe-redirect";

// GET /api/auth/google/start — hand the browser to Google, same shape as
// /api/connections/[provider]/start but for signing in rather than
// connecting an integration: a navigation (the button is a link, not a
// fetch), one-shot state + PKCE cookies scoped to /api/auth, ten minutes.

const TEN_MINUTES = 600;
const PROVIDER = "google-login";

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const clientId = await getCredential("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) {
    const url = new URL("/login", request.nextUrl.origin);
    url.searchParams.set("error", "google_unconfigured");
    return NextResponse.redirect(url);
  }

  const state = createState();
  const verifier = createVerifier();
  const authorizeUrl = buildAuthorizeUrl({
    definition: { oauth: GOOGLE_LOGIN_OAUTH },
    clientId,
    redirectUri: googleLoginRedirectUri(request.nextUrl.origin),
    state,
    codeChallenge: challengeFor(verifier),
  });

  const response = NextResponse.redirect(authorizeUrl);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/api/auth",
    maxAge: TEN_MINUTES,
  };
  response.cookies.set(stateCookie(PROVIDER), state, options);
  response.cookies.set(verifierCookie(PROVIDER), verifier, options);

  // Carried through the round trip the same way state/verifier are: Google
  // only ever echoes back what it was given (code, state), never our own
  // query params, so where a bounced session was headed has to ride a cookie
  // too or the callback has no way to know.
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "");
  if (next) response.cookies.set(nextCookie(PROVIDER), next, options);

  return response;
});
