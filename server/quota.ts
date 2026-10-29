import path from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Quota } from "../shared/account";
import { AppError } from "./errors";
import { clientKey } from "./guard";
import { dataRoot } from "./storage";
import { anonymousId, ANON_COOKIE, readCookie } from "./auth/session";
import { currentUser } from "./auth/users";

/** Local `next dev` is unlimited. Request headers cannot disable production quotas. */
function generationLimitsEnabled(): boolean {
  return process.env.NODE_ENV !== "development";
}

/** Lifetime allowance, shared by all generation routes. */
export function freeEditLimit(): number {
  const raw = process.env.FOCUS_FREE_EDITS?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : 3;
}

function legacyCount(key: string): number {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
  try {
    const used = JSON.parse(readFileSync(path.join(dataRoot(), "quota", `${hash}.json`), "utf8")).used;
    if (!Number.isInteger(used) || used < 0) throw new Error("Invalid quota counter");
    return used;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export function generationLimitError(limit = freeEditLimit()): AppError {
  return new AppError("generation_limit_reached", 403, `You’ve used all ${limit} free generations. You can still view and export your saved work.`);
}

/** Transactions coordinate route bundles and processes on the Railway volume. */
function counter(keys: readonly string[], consume: boolean, inherit?: string, mirrors: readonly string[] = []): Quota {
  let db: DatabaseSync | undefined;
  try {
    mkdirSync(path.join(dataRoot(), "quota"), { recursive: true });
    db = new DatabaseSync(path.join(dataRoot(), "quota", "generations.sqlite"));
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    db.exec("CREATE TABLE IF NOT EXISTS counters (id TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK (used >= 0))");
    db.exec("BEGIN IMMEDIATE");
    const seed = db.prepare("INSERT OR IGNORE INTO counters (id, used) VALUES (?, ?)");
    const read = db.prepare("SELECT used FROM counters WHERE id = ?");
    const initial = inherit ? Number(read.get(inherit)?.used ?? legacyCount(inherit)) : 0;
    const counts = keys.map((key) => {
      const row = read.get(key);
      if (row) return Number(row.used);
      const used = Math.max(initial, legacyCount(key));
      seed.run(key, used);
      return used;
    });
    const limit = freeEditLimit();
    let used = Math.max(...counts);
    if (consume) {
      if (used >= limit) throw generationLimitError(limit);
      used++;
      const update = db.prepare("UPDATE counters SET used = ? WHERE id = ?");
      for (const key of keys) update.run(used, key);
      // Anonymous use cannot restart by signing out of the same browser.
      const mirror = db.prepare("INSERT INTO counters (id, used) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET used = MAX(used, excluded.used)");
      for (const key of mirrors) mirror.run(key, Math.max(used, legacyCount(key)));
    }
    db.exec("COMMIT");
    return { limit, used: Math.min(limit, used), remaining: Math.max(0, limit - used) };
  } catch (error) {
    if (db?.isTransaction) db.exec("ROLLBACK");
    if (error instanceof AppError) throw error;
    throw new AppError("quota_unavailable", 503, "Your generation allowance couldn’t be checked. Try again shortly.");
  } finally {
    db?.close();
  }
}

const anonymousKeys = (request: Request, anonId: string) => [`anon:${anonId}`, `ip:${clientKey(request)}`];

export async function anonymousQuota(request: Request, anonId: string): Promise<Quota | null> {
  if (!generationLimitsEnabled()) return null;
  return counter(anonymousKeys(request, anonId), false);
}

export async function consumeFreeEdit(request: Request, anonId: string): Promise<Quota | null> {
  if (!generationLimitsEnabled()) return null;
  return counter(anonymousKeys(request, anonId), true);
}

async function requestIdentity(request: Request) {
  const user = await currentUser(request);
  if (!user) return { keys: anonymousKeys(request, anonymousId(request).id) };
  // Accounts are independent of other people on the same network. Carry
  // anonymous browser use forward once; returning accounts keep their counter.
  const anon = readCookie(request, ANON_COOKIE);
  const validAnon = anon && /^[0-9a-f-]{36}$/.test(anon) ? anon : undefined;
  return { keys: [`user:${user.id}`], inherit: validAnon ? `anon:${validAnon}` : undefined, mirrors: validAnon ? anonymousKeys(request, validAnon) : [] };
}

export async function generationQuota(request: Request): Promise<Quota | null> {
  if (!generationLimitsEnabled()) return null;
  const { keys, inherit } = await requestIdentity(request);
  return counter(keys, false, inherit);
}

export async function assertGenerationAvailable(request: Request): Promise<void> {
  const quota = await generationQuota(request);
  if (quota?.remaining === 0) throw generationLimitError(quota.limit);
}

export async function consumeGeneration(request: Request): Promise<Quota | null> {
  if (!generationLimitsEnabled()) return null;
  const { keys, inherit, mirrors } = await requestIdentity(request);
  return counter(keys, true, inherit, mirrors);
}
