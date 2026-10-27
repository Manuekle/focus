import { safeNextPath, type SessionInfo } from "../../shared/account";
import { anonymousQuota } from "../quota";
import { authMode } from "./facebook";
import { OAUTH_STATE_COOKIE, anonymousId, clearCookie, cookieHeader, createSessionToken, readCookie, sameState, sessionCookie } from "./session";
import { currentUser, publicUser, upsertFacebookUser, type FacebookProfile } from "./users";

// Shared pieces of the auth route handlers.

/** JSON with any number of Set-Cookie headers. */
export function jsonWithCookies(body: unknown, cookies: readonly (string | null)[], init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  for (const cookie of cookies) if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(body, { ...init, headers });
}

export function redirectWithCookies(location: string, cookies: readonly (string | null)[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function sessionInfo(request: Request): Promise<{ info: SessionInfo; setCookie: string | null }> {
  const user = await currentUser(request);
  if (user) return { info: { user: publicUser(user), quota: null, authMode: authMode() }, setCookie: null };
  const anon = anonymousId(request);
  return { info: { user: null, quota: await anonymousQuota(request, anon.id), authMode: authMode() }, setCookie: anon.setCookie };
}

/** The state cookie carries the random state and where to go afterwards. */
export function stateCookie(state: string, next: string): string {
  return cookieHeader(OAUTH_STATE_COOKIE, `${state}|${safeNextPath(next)}`, 600);
}

/** Checks the returned state against the cookie; gives the post-login path when it matches. */
export function checkState(request: Request, state: string | null): string | null {
  const [expected, next] = (readCookie(request, OAUTH_STATE_COOKIE) ?? "").split("|");
  return sameState(expected, state) ? safeNextPath(next) : null;
}

/** Signs the profile in: account upserted, session cookie set, state cookie cleared. */
export async function signIn(profile: FacebookProfile): Promise<readonly string[]> {
  const user = await upsertFacebookUser(profile);
  return [sessionCookie(await createSessionToken(user.id)), clearCookie(OAUTH_STATE_COOKIE)];
}
