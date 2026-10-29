import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anonymousQuota, consumeFreeEdit, consumeGeneration, freeEditLimit, generationQuota } from "./quota";
import { anonymousId, createSessionToken, resetSessionKey } from "./auth/session";
import { upsertFacebookUser } from "./auth/users";
import { sessionInfo } from "./auth/routes";
import { guardAiRequest, guardChatRequest, resetRateLimits } from "./guard";

let work: string;
beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-quota-"));
  vi.stubEnv("FOCUS_DATA_DIR", work);
  vi.stubEnv("FOCUS_SESSION_SECRET", "quota-tests-signing-key-at-least-32-characters");
  vi.stubEnv("FOCUS_FREE_EDITS", "3");
  vi.stubEnv("FOCUS_SAM_DAILY_FRAMES", "0");
  vi.stubEnv("FOCUS_AI_REQUESTS_PER_HOUR", "0");
  resetSessionKey();
  resetRateLimits();
});
afterEach(async () => { vi.unstubAllEnvs(); resetSessionKey(); await rm(work, { recursive: true, force: true }); });

async function signedRequest(ip = "198.51.100.1", cookie = "", providerId = randomUUID()) {
  const user = await upsertFacebookUser({ providerId, name: "Quota test", avatarUrl: null, email: null, simulated: true });
  const token = await createSessionToken(user.id);
  return new Request("http://localhost/api", { headers: { cookie: `focus_session=${token}; ${cookie}`, "x-real-ip": ip } });
}

describe("lifetime generation allowance", () => {
  it("allows unlimited local development without showing or changing an exhausted allowance", async () => {
    const request = await signedRequest();
    const anonymous = new Request("http://localhost/api", { headers: { cookie: `focus_anon=${randomUUID()}` } });
    for (let i = 0; i < 3; i++) await consumeGeneration(request);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FOCUS_FREE_EDITS", "0");
    for (let i = 0; i < 5; i++) {
      expect(await consumeGeneration(request)).toBeNull();
      expect(await consumeGeneration(anonymous)).toBeNull();
      await guardAiRequest(request, { activeJobs: 0, estimatedFrames: 1 });
      await guardChatRequest(request);
    }
    expect(await consumeFreeEdit(anonymous, anonymousId(anonymous).id)).toBeNull();
    expect(await generationQuota(request)).toBeNull();
    expect((await sessionInfo(request)).info.quota).toBeNull();
    expect((await sessionInfo(anonymous)).info.quota).toBeNull();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FOCUS_FREE_EDITS", "3");
    expect((await generationQuota(request))?.used).toBe(3);
    await expect(consumeGeneration(request)).rejects.toMatchObject({ code: "generation_limit_reached" });
  });

  it("keeps the production limit when request headers claim localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://localhost/api", { headers: { host: "localhost:3200", "x-forwarded-host": "localhost", "x-real-ip": "127.0.0.1", cookie: `focus_anon=${randomUUID()}` } });
    for (let i = 0; i < 3; i++) await consumeGeneration(request);
    expect((await sessionInfo(request)).info.quota).toEqual({ limit: 3, used: 3, remaining: 0 });
    await expect(consumeGeneration(request)).rejects.toMatchObject({ code: "generation_limit_reached" });
  });

  it("gives signed-in users exactly three uses across concurrent requests", async () => {
    const request = await signedRequest();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeGeneration(request)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected").every((result) => result.status === "rejected" && result.reason.code === "generation_limit_reached")).toBe(true);
    expect((await sessionInfo(request)).info.quota).toEqual({ used: 3, remaining: 0, limit: 3 });
  });

  it("lets only one independent process take the last persisted generation", async () => {
    const anon = randomUUID();
    const request = new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.101" } });
    await consumeFreeEdit(request, anon);
    await consumeFreeEdit(request, anon);
    const script = `
      import { registerHooks } from "node:module";
      import { existsSync, readFileSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      import ts from "typescript";
      registerHooks({ resolve(specifier, context, next) {
        if (specifier.startsWith(".")) {
          const candidate = new URL(specifier + ".ts", context.parentURL);
          if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
        }
        return next(specifier, context);
      }, load(url, context, next) {
        if (url.endsWith(".ts")) return { format: "module", source: ts.transpile(readFileSync(new URL(url), "utf8"), { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }), shortCircuit: true };
        return next(url, context);
      }});
      const { consumeFreeEdit } = await import("./server/quota.ts");
      try {
        await consumeFreeEdit(new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.101" } }), process.env.FOCUS_TEST_ANON_ID);
        console.log("accepted");
      } catch (error) { console.log(error.code); }
    `;
    const results = await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, FOCUS_TEST_ANON_ID: anon } })));
    expect(results.map((result) => result.stdout.trim()).sort()).toEqual(["accepted", "generation_limit_reached", "generation_limit_reached", "generation_limit_reached"]);
    expect((await anonymousQuota(request, anon))?.used).toBe(3);
  });

  it("persists across login, new sessions and IP changes without penalizing another account on the same network", async () => {
    const providerId = randomUUID();
    const first = await signedRequest("198.51.100.2", "", providerId);
    for (let i = 0; i < 3; i++) await consumeGeneration(first);
    resetSessionKey();
    const returned = await signedRequest("203.0.113.4", "", providerId);
    await expect(consumeGeneration(returned)).rejects.toMatchObject({ code: "generation_limit_reached", status: 403 });
    expect((await generationQuota(await signedRequest("198.51.100.2")))?.remaining).toBe(3);
  });

  it("carries anonymous browser use into the account once", async () => {
    const anonId = randomUUID();
    await consumeFreeEdit(new Request("http://localhost"), anonId);
    const request = await signedRequest("198.51.100.3", `focus_anon=${anonId}`);
    expect((await generationQuota(request))?.used).toBe(1);
    await consumeGeneration(request);
    expect((await generationQuota(request))?.used).toBe(2);
  });

  it("counts a first request without a cookie against the cookie it returns", async () => {
    const request = new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.99" } });
    const anon = anonymousId(request);
    await consumeGeneration(request);
    expect(anonymousId(request)).toEqual(anon);
    const signed = await signedRequest("203.0.113.99", `focus_anon=${anon.id}`);
    expect((await generationQuota(signed))?.used).toBe(1);
  });

  it("does not restore anonymous generations when an exhausted user signs out", async () => {
    const anon = randomUUID();
    const request = await signedRequest("198.51.100.31", `focus_anon=${anon}`);
    for (let i = 0; i < 3; i++) await consumeGeneration(request);
    const signedOut = new Request("http://localhost", { headers: { cookie: `focus_anon=${anon}`, "x-real-ip": "198.51.100.31" } });
    await expect(consumeGeneration(signedOut)).rejects.toMatchObject({ code: "generation_limit_reached" });
  });

  it("migrates existing anonymous JSON counters without resetting them", async () => {
    const id = randomUUID(), key = `anon:${id}`;
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
    await mkdir(path.join(work, "quota"));
    await writeFile(path.join(work, "quota", `${hash}.json`), JSON.stringify({ used: 3 }));
    const request = new Request("http://localhost", { headers: { "x-real-ip": "203.0.113.8" } });
    expect((await anonymousQuota(request, id))?.remaining).toBe(0);
    await expect(consumeFreeEdit(request, id)).rejects.toMatchObject({ code: "generation_limit_reached" });
  });

  it("fails closed on corrupt persisted counters", async () => {
    const id = randomUUID();
    const hash = createHash("sha256").update(`anon:${id}`).digest("hex").slice(0, 32);
    await mkdir(path.join(work, "quota"));
    await writeFile(path.join(work, "quota", `${hash}.json`), "broken");
    await expect(anonymousQuota(new Request("http://localhost"), id)).rejects.toMatchObject({ code: "quota_unavailable" });
  });

  it("blocks new work and chat at exhaustion but lets the last animation finish its initial drawings", async () => {
    const request = await signedRequest();
    for (let i = 0; i < 3; i++) await guardAiRequest(request, { activeJobs: 0, estimatedFrames: 1 });
    await expect(guardAiRequest(request, { activeJobs: 0, estimatedFrames: 1 })).rejects.toMatchObject({ code: "generation_limit_reached" });
    await expect(guardChatRequest(request)).rejects.toMatchObject({ code: "generation_limit_reached" });
    await guardAiRequest(request, { activeJobs: 0, estimatedFrames: 8 }, { continuation: true });
    expect((await generationQuota(request))?.used).toBe(3);
  });

  it("does not spend a use for a preview or rejected busy request", async () => {
    const request = await signedRequest();
    await guardAiRequest(request, { activeJobs: 0, estimatedFrames: 1 }, { charge: false });
    await expect(guardAiRequest(request, { activeJobs: 100, estimatedFrames: 1 })).rejects.toMatchObject({ code: "busy" });
    expect((await generationQuota(request))?.used).toBe(0);
  });

  it("treats empty config as the default and preserves an explicit zero limit", () => {
    vi.stubEnv("FOCUS_FREE_EDITS", ""); expect(freeEditLimit()).toBe(3);
    vi.stubEnv("FOCUS_FREE_EDITS", "0"); expect(freeEditLimit()).toBe(0);
  });
});
