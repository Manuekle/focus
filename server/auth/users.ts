import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { UserSchema, type PublicUser, type User } from "../../shared/account";
import { dataRoot } from "../storage";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "./session";

// Accounts are JSON files: users/<id>.json, plus an index from the Facebook
// id to the user id so a returning person gets the same account.

function usersDir(): string {
  return path.join(dataRoot(), "users");
}

function userFile(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("invalid user id");
  return path.join(usersDir(), `${id}.json`);
}

function indexFile(providerId: string): string {
  return path.join(usersDir(), "by-provider", `${createHash("sha256").update(`facebook:${providerId}`).digest("hex").slice(0, 32)}.json`);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}

export async function getUser(id: string): Promise<User | null> {
  const raw = await readFile(userFile(id), "utf8").catch(() => null);
  if (!raw) return null;
  const parsed = UserSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export type FacebookProfile = {
  readonly providerId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly email: string | null;
  readonly simulated: boolean;
};

/** Finds the account for a Facebook identity, creating it on first sign-in; refreshes name and picture. */
export async function upsertFacebookUser(profile: FacebookProfile): Promise<User> {
  const index = await readFile(indexFile(profile.providerId), "utf8").then((raw) => JSON.parse(raw) as { userId: string }, () => null);
  const existing = index ? await getUser(index.userId) : null;
  const user = UserSchema.parse({
    id: existing?.id ?? randomUUID(),
    provider: "facebook",
    providerId: profile.providerId,
    name: profile.name.trim().slice(0, 80) || "Focus user",
    avatarUrl: profile.avatarUrl,
    email: profile.email,
    simulated: profile.simulated,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
  await writeJson(userFile(user.id), user);
  if (!existing) await writeJson(indexFile(profile.providerId), { userId: user.id });
  return user;
}

/** The signed-in user of a request, or null. */
export async function currentUser(request: Request): Promise<User | null> {
  const id = await verifySessionToken(readCookie(request, SESSION_COOKIE));
  return id ? getUser(id) : null;
}

export function publicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, simulated: user.simulated };
}
