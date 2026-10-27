import path from "node:path";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AppError } from "../errors";
import { dataRoot } from "../storage";

// Sessions are stateless signed cookies: `<userId>.<expiresAt>.<hmac>`. The
// signing key comes from FOCUS_SESSION_SECRET, or is generated once and kept
// next to the data (0600) for local use.

export const SESSION_COOKIE = "focus_session";
export const ANON_COOKIE = "focus_anon";
export const OAUTH_STATE_COOKIE = "focus_oauth_state";
const SESSION_DAYS = 30;

let secret: Buffer | null = null;

async function signingKey(): Promise<Buffer> {
  if (secret) return secret;
  const configured = process.env.FOCUS_SESSION_SECRET;
  if (configured) {
    if (configured.length < 32) throw new AppError("auth_not_configured", 503, "FOCUS_SESSION_SECRET debe tener al menos 32 caracteres.");
    return (secret = Buffer.from(configured));
  }
  if (process.env.NODE_ENV === "production") throw new AppError("auth_not_configured", 503, "Falta FOCUS_SESSION_SECRET en el servidor: el inicio de sesión no está disponible.");
  const file = path.join(dataRoot(), "session-secret.key");
  const stored = await readFile(file).catch(() => null);
  if (stored && stored.length >= 32) return (secret = stored);
  const fresh = randomBytes(48);
  await mkdir(dataRoot(), { recursive: true });
  await writeFile(file, fresh, { mode: 0o600 });
  return (secret = fresh);
}

/** Tests switch data roots; the cached key must follow. */
export function resetSessionKey(): void {
  secret = null;
}

async function sign(value: string): Promise<string> {
  return createHmac("sha256", await signingKey()).update(value).digest("base64url");
}

export async function createSessionToken(userId: string, now = Date.now()): Promise<string> {
  const body = `${userId}.${now + SESSION_DAYS * 86_400_000}`;
  return `${body}.${await sign(body)}`;
}

/** The user id inside a valid, unexpired token; null otherwise. */
export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  if (!/^[0-9a-f-]{36}$/.test(userId) || !/^\d+$/.test(expires) || Number(expires) < now) return null;
  const expected = Buffer.from(await sign(`${userId}.${expires}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export const sessionCookie = (token: string) => cookieHeader(SESSION_COOKIE, token, SESSION_DAYS * 86_400);
export const clearCookie = (name: string) => cookieHeader(name, "", 0);

/**
 * The anonymous visitor id that free edits are counted against. Returns the
 * cookie to set when the visitor had none.
 */
export function anonymousId(request: Request): { id: string; setCookie: string | null } {
  const existing = readCookie(request, ANON_COOKIE);
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return { id: existing, setCookie: null };
  const id = randomUUID();
  return { id, setCookie: cookieHeader(ANON_COOKIE, id, 365 * 86_400) };
}

/** Random, URL-safe; ties the Facebook redirect back to the browser that started it. */
export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
