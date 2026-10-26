import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { accountExists, claimState, loginWithVerifiedEmail, sessionCookie } from "@/lib/auth/store";
import { challengeCookie, createChallenge, requiresTwoFactor } from "@/lib/auth/two-factor";
import { decideSignup } from "@/lib/auth/signup-policy";
import { getCredential } from "@/lib/credentials";
import { fetchGoogleIdentity, GOOGLE_LOGIN_OAUTH } from "@/lib/google-login-oauth";
import {
  exchangeCode,
  googleLoginRedirectUri,
  nextCookie,
  stateCookie,
  verifierCookie,
} from "@/lib/oauth-client";
import { safeNextPath } from "@/lib/safe-redirect";
import { setGooglePicture } from "@/lib/account-store";

// GET /api/auth/google/callback — where Google sends the browser back.
//
// Every exit is a redirect to /login (on failure) or straight past it (on
// success), because this is a browser tab, not a fetch caller. /login turns
// `?error=` into a sentence in the visitor's language, same as the existing
// `?reset=1` flag.

const PROVIDER = "google-login";

function toLogin(request: NextRequest, error: string): NextResponse {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

/** The address is Google-verified by now; what is left is whether it may have
 *  this installation, and then a session. */
async function signIn(
  request: NextRequest,
  email: string,
  picture: string | undefined,
  next: string | undefined,
): Promise<NextResponse> {
  // `loginWithVerifiedEmail` creates the account when it does not exist, so
  // this button is a registration endpoint as much as a sign-in one — and it
  // would be the way around lib/auth/signup-policy.ts if it did not ask.
  // Google proves the address belongs to whoever is holding it; it says
  // nothing about whether that person may have this installation.
  const refused =
    !(await accountExists(email)) && !decideSignup({ email, claim: await claimState() }).allowed;
  if (refused) return toLogin(request, "signup_closed");

  // Two-step verification on (lib/auth/two-factor.ts): Google proves the
  // first factor only. No session yet: a one-time challenge, and the login
  // page asks for the code.
  if (await requiresTwoFactor(email)) {
    const ticket = await createChallenge(email);
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("step", "2fa");
    if (next) login.searchParams.set("next", safeNextPath(next, "/dashboard"));
    const response = NextResponse.redirect(login);
    response.cookies.set(challengeCookie(ticket, request.nextUrl.protocol === "https:"));
    return response;
  }

  const session = await loginWithVerifiedEmail(email);

  // Best-effort, and only once the visitor is in: a refused sign-in must not
  // write anything. No picture is better than a broken login flow.
  if (picture) await setGooglePicture(picture).catch(() => {});

  // Not "/chat": that path rewrites to "/", which a later rewrite rule
  // (the unconditional "/" -> "/landing" in next.config.ts) re-matches and
  // sends on to the marketing page instead — see the identical bug fixed
  // for /landing itself in the redirect-loop commit. "/dashboard" is the
  // same destination the landing page's own "already signed in" button
  // already trusts (app/landing/_components/landing-hero.tsx).
  const destination = safeNextPath(next, "/dashboard");
  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin));
  response.cookies.set(sessionCookie(session.token, request.nextUrl.protocol === "https:"));
  return response;
}

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The consent screen has a Cancel button, and pressing it is not an error
  // worth a red banner.
  const denied = params.get("error");
  if (denied) return toLogin(request, denied === "access_denied" ? "google_denied" : "google_failed");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(stateCookie(PROVIDER))?.value;
  const verifier = request.cookies.get(verifierCookie(PROVIDER))?.value;
  const next = request.cookies.get(nextCookie(PROVIDER))?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    console.error(
      "[auth/google/callback] state check failed:",
      JSON.stringify({ hasCode: Boolean(code), hasState: Boolean(state), hasExpectedState: Boolean(expectedState), stateMatches: state === expectedState }),
    );
    return toLogin(request, "google_failed");
  }

  const clientId = await getCredential("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = await getCredential("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return toLogin(request, "google_unconfigured");

  let result: NextResponse;
  try {
    const tokens = await exchangeCode({
      definition: { oauth: GOOGLE_LOGIN_OAUTH },
      clientId,
      clientSecret,
      code,
      redirectUri: googleLoginRedirectUri(request.nextUrl.origin),
      codeVerifier: verifier,
    });

    // Not best-effort: this one call says whose inbox this is and whether
    // Google has verified it, and an unverified address proves nothing — see
    // readGoogleIdentity.
    const identity = await fetchGoogleIdentity(tokens.accessToken);
    result = identity.ok
      ? await signIn(request, identity.email, identity.picture, next)
      : toLogin(request, identity.reason === "unverified" ? "google_unverified" : "google_failed");
  } catch (error) {
    console.error(
      "[auth/google/callback] exchange or login failed:",
      error instanceof Error ? error.message : String(error),
    );
    result = toLogin(request, "google_failed");
  }

  // The code is spent either way, so the one-shot cookies go with it.
  result.cookies.delete({ name: stateCookie(PROVIDER), path: "/api/auth" });
  result.cookies.delete({ name: verifierCookie(PROVIDER), path: "/api/auth" });
  result.cookies.delete({ name: nextCookie(PROVIDER), path: "/api/auth" });
  return result;
});
