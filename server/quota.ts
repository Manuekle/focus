import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { Quota } from "../shared/account";
import { AppError } from "./errors";
import { clientKey } from "./guard";
import { dataRoot } from "./storage";

// Free AI edits without an account. A visitor is counted twice, by their
// anonymous cookie and by their client address, and the higher count wins:
// clearing cookies alone does not reset the allowance.
//
//   FOCUS_FREE_EDITS=3   new AI edits allowed before Facebook sign-in

export function freeEditLimit(): number {
  const value = Number(process.env.FOCUS_FREE_EDITS);
  return Number.isInteger(value) && value >= 0 ? value : 3;
}

function counterFile(key: string): string {
  return path.join(dataRoot(), "quota", `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
}

async function readCount(key: string): Promise<number> {
  const raw = await readFile(counterFile(key), "utf8").catch(() => null);
  const used = raw ? Number((JSON.parse(raw) as { used?: unknown }).used) : 0;
  return Number.isInteger(used) && used > 0 ? used : 0;
}

async function writeCount(key: string, used: number): Promise<void> {
  const file = counterFile(key);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ used, updatedAt: new Date().toISOString() }));
  await rename(temp, file);
}

const keysFor = (request: Request, anonId: string) => [`anon:${anonId}`, `ip:${clientKey(request)}`];

// One read-modify-write at a time, so two quick clicks cannot both take the last edit.
const chain = ((globalThis as { __focusQuota?: { last: Promise<unknown> } }).__focusQuota ??= { last: Promise.resolve() });
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.last.then(task, task);
  chain.last = next.catch(() => undefined);
  return next;
}

export async function anonymousQuota(request: Request, anonId: string): Promise<Quota> {
  const limit = freeEditLimit();
  const used = Math.min(limit, Math.max(...(await Promise.all(keysFor(request, anonId).map(readCount)))));
  return { limit, used, remaining: Math.max(0, limit - used) };
}

/** Takes one free edit, or refuses with `login_required` when none are left. */
export function consumeFreeEdit(request: Request, anonId: string): Promise<Quota> {
  return serialized(async () => {
    const keys = keysFor(request, anonId);
    const counts = await Promise.all(keys.map(readCount));
    const used = Math.max(...counts);
    const limit = freeEditLimit();
    if (used >= limit) {
      throw new AppError("login_required", 401, `You’ve used all ${limit} free edits. Sign in with Facebook to keep editing and save your projects.`);
    }
    await Promise.all(keys.map((key) => writeCount(key, used + 1)));
    return { limit, used: used + 1, remaining: Math.max(0, limit - used - 1) };
  });
}
