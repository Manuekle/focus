import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors";
import type { FacebookProfile } from "./users";

// Facebook Login through Meta's Graph API (OAuth 2.0 authorization-code flow):
//   1. /api/auth/facebook       → redirect to facebook.com/<v>/dialog/oauth
//   2. Facebook                 → /api/auth/facebook/callback?code&state
//   3. code → access token (server to server, with the app secret)
//   4. /me?fields=id,name,email,picture → the account
// Until FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are set, the same routes run a
// local simulated sign-in instead (development only, unless forced on).
//
//   FACEBOOK_APP_ID / FACEBOOK_APP_SECRET   Meta app credentials
//   FACEBOOK_GRAPH_VERSION=v23.0            Graph API version
//   FOCUS_PUBLIC_URL=https://…              origin for the OAuth redirect URI
//   FOCUS_AUTH_SIMULATED=1                  allow the simulated login in production

export type FacebookConfig = { readonly appId: string; readonly appSecret: string; readonly version: string };

export function readFacebookConfig(env: Readonly<Record<string, string | undefined>> = process.env): FacebookConfig | null {
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret, version: env.FACEBOOK_GRAPH_VERSION ?? "v23.0" };
}

export type AuthMode = "facebook" | "simulated";

export function authMode(env: Readonly<Record<string, string | undefined>> = process.env): AuthMode {
  return readFacebookConfig(env) ? "facebook" : "simulated";
}

/** The simulated login stands in for Facebook only on local and test installs. */
export function simulatedLoginAllowed(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return authMode(env) === "simulated" && (env.NODE_ENV !== "production" || env.FOCUS_AUTH_SIMULATED === "1");
}

export function callbackUrl(request: Request): string {
  const origin = process.env.FOCUS_PUBLIC_URL?.replace(/\/+$/, "") ?? new URL(request.url).origin;
  return `${origin}/api/auth/facebook/callback`;
}

export function authorizeUrl(config: FacebookConfig, redirectUri: string, state: string): string {
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "public_profile,email");
  return url.toString();
}

const TokenSchema = z.object({ access_token: z.string().min(1) });
const MeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  email: z.string().optional(),
  picture: z.object({ data: z.object({ url: z.string().optional(), is_silhouette: z.boolean().optional() }) }).optional(),
});

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function graph<T>(fetcher: Fetch, url: URL, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError("facebook_unreachable", 502, "We couldn’t connect to Facebook. Try again.");
  }
  const body = await response.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!response.ok || !parsed.success) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new AppError("facebook_rejected", 502, "Facebook couldn’t confirm your sign-in. Try again.", message);
  }
  return parsed.data;
}

/** Steps 3 and 4: trades the one-time code for the person's Facebook profile. */
export async function exchangeCode(config: FacebookConfig, code: string, redirectUri: string, fetcher: Fetch = fetch): Promise<FacebookProfile> {
  const tokenUrl = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", config.appId);
  tokenUrl.searchParams.set("client_secret", config.appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);
  const { access_token: token } = await graph(fetcher, tokenUrl, TokenSchema);

  const meUrl = new URL(`https://graph.facebook.com/${config.version}/me`);
  meUrl.searchParams.set("fields", "id,name,email,picture.width(160).height(160)");
  meUrl.searchParams.set("access_token", token);
  // Proves the call comes from the app's server, not a leaked token.
  meUrl.searchParams.set("appsecret_proof", createHmac("sha256", config.appSecret).update(token).digest("hex"));
  const me = await graph(fetcher, meUrl, MeSchema);

  const picture = me.picture?.data;
  const avatarUrl = picture?.url && !picture.is_silhouette && z.url().safeParse(picture.url).success ? picture.url : null;
  const email = me.email && z.email().safeParse(me.email).success ? me.email : null;
  return { providerId: me.id, name: me.name, avatarUrl, email, simulated: false };
}

/** The local stand-in: the same name always maps to the same simulated account. */
export function simulatedProfile(name: string): FacebookProfile {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (clean.length < 2) throw new AppError("invalid_name", 400, "Enter a name with at least 2 characters.");
  return {
    providerId: `sim-${createHash("sha256").update(clean.toLowerCase()).digest("hex").slice(0, 24)}`,
    name: clean,
    avatarUrl: null,
    email: null,
    simulated: true,
  };
}
