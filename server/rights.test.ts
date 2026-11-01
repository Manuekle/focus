import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RIGHTS_ERROR_CODE, RIGHTS_HEADER, RIGHTS_VERSION, RightsRecordSchema } from "../shared/rights";

// The server refuses to start processing without the acknowledgement, whatever
// the browser did. Heavy collaborators are replaced: only the gate is under test.

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const createJob = vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", videoId: VIDEO_ID }));
vi.mock("./jobs", () => ({ createJob: (...args: unknown[]) => (createJob as (...a: unknown[]) => unknown)(...args) }));
vi.mock("./guard", async (original) => ({ ...(await original<typeof import("./guard")>()), guardAiRequest: vi.fn(async () => undefined) }));
vi.mock("./auth/users", () => ({ currentUser: vi.fn(async () => null) }));

let dir: string;
const previous = process.env.FOCUS_DATA_DIR;
const FLAGS = ["NEXT_PUBLIC_ENABLE_FLIPBOOK", "NEXT_PUBLIC_ENABLE_REFERENCE_MOTION", "NEXT_PUBLIC_ENABLE_ROTOSCOPE"] as const;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "focus-rights-"));
  process.env.FOCUS_DATA_DIR = dir;
  // The features are off by default; a disabled one answers 404 before anything else.
  for (const flag of FLAGS) vi.stubEnv(flag, "true");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (previous === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = previous;
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => createJob.mockClear());

const edit = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/edits", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ videoId: VIDEO_ID, effect: "erase", prompt: "remove the logo" }),
  });

describe("requireRights", () => {
  it("rejects a request without the acknowledgement", async () => {
    const { requireRights } = await import("./rights");
    expect(() => requireRights(new Request("http://localhost/x", { method: "POST" }))).toThrowError(expect.objectContaining({ code: RIGHTS_ERROR_CODE, status: 422 }));
  });

  it("rejects an outdated acknowledgement version", async () => {
    const { requireRights } = await import("./rights");
    const request = new Request("http://localhost/x", { method: "POST", headers: { [RIGHTS_HEADER]: "1999-01" } });
    expect(() => requireRights(request)).toThrowError(expect.objectContaining({ code: RIGHTS_ERROR_CODE }));
  });

  it("accepts the current version", async () => {
    const { requireRights } = await import("./rights");
    const request = new Request("http://localhost/x", { method: "POST", headers: { [RIGHTS_HEADER]: RIGHTS_VERSION } });
    expect(() => requireRights(request)).not.toThrow();
  });
});

describe("recordRights", () => {
  it("stores minimal metadata once per subject", async () => {
    const { recordRights, readRights } = await import("./rights");
    const first = await recordRights("edit", "job-1", [VIDEO_ID], new Date("2026-10-31T10:00:00Z"));
    const again = await recordRights("edit", "job-1", [VIDEO_ID], new Date("2026-11-01T10:00:00Z"));
    expect(again.confirmedAt).toBe(first.confirmedAt);
    expect((await readdir(path.join(dir, "rights"))).filter((name) => name === "edit-job-1.json")).toHaveLength(1);
    const stored = RightsRecordSchema.parse(JSON.parse(await readFile(path.join(dir, "rights", "edit-job-1.json"), "utf8")));
    expect(stored).toEqual({ status: "confirmed", version: RIGHTS_VERSION, confirmedAt: "2026-10-31T10:00:00.000Z", subjectKind: "edit", subjectId: "job-1", assetIds: [VIDEO_ID] });
    expect(await readRights("edit", "job-1")).toEqual(stored);
  });

  it("never lets a subject id escape the folder", async () => {
    const { recordRights } = await import("./rights");
    await expect(recordRights("edit", "../escape", [])).rejects.toThrow();
  });
});

describe("POST /api/edits", () => {
  it("returns a structured validation error and starts nothing when unconfirmed", async () => {
    const { POST } = await import("../app/api/edits/route");
    const response = await POST(edit());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: RIGHTS_ERROR_CODE, message: expect.stringContaining("rights") } });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("rejects a direct call with a stale acknowledgement", async () => {
    const { POST } = await import("../app/api/edits/route");
    const response = await POST(edit({ [RIGHTS_HEADER]: "1999-01" }));
    expect(response.status).toBe(422);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("starts the job and records the acknowledgement when confirmed", async () => {
    const { POST } = await import("../app/api/edits/route");
    const response = await POST(edit({ [RIGHTS_HEADER]: RIGHTS_VERSION }));
    expect(response.status).toBe(202);
    expect(createJob).toHaveBeenCalledTimes(1);
    const record = JSON.parse(await readFile(path.join(dir, "rights", "edit-22222222-2222-4222-8222-222222222222.json"), "utf8"));
    expect(record).toMatchObject({ status: "confirmed", version: RIGHTS_VERSION, subjectKind: "edit", assetIds: [VIDEO_ID] });
    expect(Object.keys(record).sort()).toEqual(["assetIds", "confirmedAt", "status", "subjectId", "subjectKind", "version"]);
  });
});

describe("every other processing entry point", () => {
  const cases: readonly [string, () => Promise<{ POST: (request: Request) => Promise<Response> }>][] = [
    ["/api/rotoscope/runs", () => import("../app/api/rotoscope/runs/route")],
    ["/api/rotoscope/batches", () => import("../app/api/rotoscope/batches/route")],
    ["/api/animations/jobs", () => import("../app/api/animations/jobs/route")],
    ["/api/flipbooks", () => import("../app/api/flipbooks/route")],
  ];
  for (const [url, load] of cases) {
    it(`${url} refuses an unconfirmed request`, async () => {
      const { POST } = await load();
      const response = await POST(new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe(RIGHTS_ERROR_CODE);
    });

    it(`${url} gets past the rights check once confirmed`, async () => {
      const { POST } = await load();
      const response = await POST(new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", [RIGHTS_HEADER]: RIGHTS_VERSION }, body: "{}" }));
      // Any other refusal (feature off, sign-in, bad input) proves the gate did not block it.
      const body = await response.json().catch(() => null);
      expect(body?.error?.code).not.toBe(RIGHTS_ERROR_CODE);
    });
  }
});
