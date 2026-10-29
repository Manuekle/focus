import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { safeNextPath } from "../../shared/account";
import { resetRateLimits } from "../guard";
import { consumeFreeEdit, anonymousQuota } from "../quota";
import { attachJob, deleteProject, getProject, listProjects, projectForVideo, retainedIds } from "../projects";
import { authorizeUrl, exchangeCode, simulatedLoginAllowed, simulatedProfile } from "./facebook";
import { checkState, signIn, stateCookie } from "./routes";
import { createSessionToken, resetSessionKey, verifySessionToken } from "./session";
import { currentUser, upsertFacebookUser } from "./users";

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-auth-"));
  process.env.FOCUS_DATA_DIR = work;
  resetSessionKey();
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.FOCUS_FREE_EDITS;
  resetRateLimits();
});

const requestWith = (cookie: string, ip = "198.51.100.7") => new Request("http://localhost/x", { headers: { cookie, "x-real-ip": ip } });
const cookieValue = (setCookie: string) => setCookie.split(";")[0];

describe("sessions", () => {
  it("accepts its own tokens and rejects tampered or expired ones", async () => {
    const id = "6f1c2a3e-1111-4222-8333-944455556666";
    const token = await createSessionToken(id);
    expect(await verifySessionToken(token)).toBe(id);
    expect(await verifySessionToken(token.replace(id, "6f1c2a3e-1111-4222-8333-944455556667"))).toBeNull();
    expect(await verifySessionToken(`${token}x`)).toBeNull();
    expect(await verifySessionToken(token, Date.now() + 31 * 86_400_000)).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
  });

  it("only allows same-site relative paths after sign-in", () => {
    expect(safeNextPath("/editor?v=1")).toBe("/editor?v=1");
    expect(safeNextPath("https://evil.example")).toBe("/editor");
    expect(safeNextPath("//evil.example")).toBe("/editor");
    expect(safeNextPath("/\\evil.example")).toBe("/editor");
    expect(safeNextPath(null)).toBe("/editor");
  });
});

describe("facebook sign-in", () => {
  it("builds the Facebook Login dialog URL", () => {
    const url = new URL(authorizeUrl({ appId: "123", appSecret: "s", version: "v23.0" }, "https://focus.test/api/auth/facebook/callback", "st"));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v23.0/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "123", state: "st", response_type: "code", scope: "public_profile,email" });
  });

  it("exchanges the code and reads the profile, with appsecret_proof", async () => {
    const calls: string[] = [];
    const fake = async (input: string) => {
      calls.push(input);
      if (input.includes("/oauth/access_token")) return Response.json({ access_token: "tok", token_type: "bearer" });
      return Response.json({ id: "10229", name: "Ana García", email: "ana@example.com", picture: { data: { url: "https://scontent.example/ana.jpg", is_silhouette: false } } });
    };
    const profile = await exchangeCode({ appId: "123", appSecret: "secret", version: "v23.0" }, "code-1", "https://focus.test/cb", fake);
    expect(profile).toEqual({ providerId: "10229", name: "Ana García", avatarUrl: "https://scontent.example/ana.jpg", email: "ana@example.com", simulated: false });
    expect(new URL(calls[0]).searchParams.get("code")).toBe("code-1");
    expect(new URL(calls[1]).searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a profile Facebook did not confirm", async () => {
    const fake = async () => Response.json({ error: { message: "Invalid verification code" } }, { status: 400 });
    await expect(exchangeCode({ appId: "1", appSecret: "s", version: "v23.0" }, "bad", "https://x/cb", fake)).rejects.toMatchObject({ code: "facebook_rejected" });
  });

  it("simulated sign-in is development-only and stable per name", () => {
    expect(simulatedLoginAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(simulatedLoginAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(simulatedLoginAllowed({ NODE_ENV: "production", FOCUS_AUTH_SIMULATED: "1" })).toBe(true);
    expect(simulatedLoginAllowed({ NODE_ENV: "development", FACEBOOK_APP_ID: "1", FACEBOOK_APP_SECRET: "s" })).toBe(false);
    expect(simulatedProfile("Ana  García").providerId).toBe(simulatedProfile("ana garcía").providerId);
    expect(() => simulatedProfile(" ")).toThrow();
  });

  it("checks the OAuth state and signs the same person into the same account", async () => {
    const cookie = cookieValue(stateCookie("abc", "/editor?v=1"));
    expect(checkState(requestWith(cookie), "abc")).toBe("/editor?v=1");
    expect(checkState(requestWith(cookie), "abd")).toBeNull();
    expect(checkState(requestWith(""), "abc")).toBeNull();

    const [session] = await signIn(simulatedProfile("Luis"));
    const user = await currentUser(requestWith(cookieValue(session)));
    expect(user).toMatchObject({ name: "Luis", provider: "facebook", simulated: true });
    const again = await upsertFacebookUser(simulatedProfile("luis"));
    expect(again.id).toBe(user!.id);
  });
});

describe("free edits", () => {
  it("allows three edits without an account, counted by cookie and address", async () => {
    const request = requestWith("", "203.0.113.9");
    for (let index = 0; index < 3; index++) await consumeFreeEdit(request, "11111111-1111-4111-8111-111111111111");
    expect(await anonymousQuota(request, "11111111-1111-4111-8111-111111111111")).toEqual({ limit: 3, used: 3, remaining: 0 });
    await expect(consumeFreeEdit(request, "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "generation_limit_reached" });
    // A fresh cookie from the same address does not reset the allowance.
    await expect(consumeFreeEdit(request, "22222222-2222-4222-8222-222222222222")).rejects.toMatchObject({ code: "generation_limit_reached" });
  });

  it("is configurable", async () => {
    process.env.FOCUS_FREE_EDITS = "1";
    const request = requestWith("", "203.0.113.50");
    await consumeFreeEdit(request, "33333333-3333-4333-8333-333333333333");
    await expect(consumeFreeEdit(request, "33333333-3333-4333-8333-333333333333")).rejects.toMatchObject({ code: "generation_limit_reached" });
  });

  it("never lets two simultaneous requests share the last edit", async () => {
    const request = requestWith("", "203.0.113.77");
    const results = await Promise.allSettled([0, 1, 2, 3, 4].map(() => consumeFreeEdit(request, "44444444-4444-4444-8444-444444444444")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
  });
});

describe("projects", () => {
  const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const video = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const jobs = ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];

  it("keeps one project per clip, records each edit, and hides it from other accounts", async () => {
    const first = await projectForVideo(owner, video, { title: "beach", jobIds: [jobs[0]] });
    const attached = await attachJob(owner, video, jobs[1], "ignored");
    expect(attached.id).toBe(first.id);
    expect(attached.jobIds).toEqual(jobs);
    expect(attached.activeJobId).toBe(jobs[1]);
    expect((await listProjects(owner)).map((project) => project.id)).toEqual([first.id]);
    expect(await listProjects(other)).toEqual([]);
    await expect(getProject(first.id, other)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(deleteProject(first.id, other)).rejects.toMatchObject({ code: "project_not_found" });
  });

  it("protects saved clips and edits from cleanup until deleted", async () => {
    const project = (await listProjects(owner))[0];
    const kept = await retainedIds();
    expect(kept.videos.has(video)).toBe(true);
    expect(kept.jobs.has(jobs[0])).toBe(true);
    await deleteProject(project.id, owner);
    expect((await retainedIds()).videos.has(video)).toBe(false);
  });
});
