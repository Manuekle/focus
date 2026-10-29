import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertModelsAvailable } from "./availability";
import { guardAiRequest } from "../guard";
import { generationQuota } from "../quota";

const models = ["muse-spark-1.3", "muse-image-1.0", "sam-3.1"];
let work: string;
beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-model-check-"));
  vi.stubEnv("MODEL_API_KEY", `test-${randomUUID()}`);
  vi.stubEnv("FOCUS_DATA_DIR", work);
  vi.stubEnv("FOCUS_FREE_EDITS", "3");
  vi.stubEnv("FOCUS_SAM_DAILY_FRAMES", "0");
  vi.stubEnv("FOCUS_AI_REQUESTS_PER_HOUR", "0");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(work, { recursive: true, force: true }); });

describe("provider availability before generation", () => {
  it("checks the authenticated catalog without running a paid model and caches success", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: models.map((id) => ({ id })) }));
    vi.stubGlobal("fetch", fetcher);
    await assertModelsAvailable(["planner", "image", "segmentation"]);
    await assertModelsAvailable(["image"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toMatchObject(["https://api.meta.ai/v1/models", { headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}` }, redirect: "error" }]);
  });

  it("rechecks an empty catalog on retry and honours configured model names", async () => {
    vi.stubEnv("META_IMAGE_MODEL", "custom-image");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] })).mockResolvedValueOnce(Response.json({ data: [{ id: "custom-image" }] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(assertModelsAvailable(["image"])).rejects.toMatchObject({ code: "meta_model_not_found" });
    await expect(assertModelsAvailable(["image"])).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not consume a generation when production cannot access a required model", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "sam-3.1" }] })));
    const request = new Request("http://localhost", { headers: { "x-real-ip": randomUUID(), cookie: `focus_anon=${randomUUID()}` } });
    await expect(guardAiRequest(request, { activeJobs: 0, estimatedFrames: 8 })).rejects.toMatchObject({ code: "meta_model_not_found" });
    expect((await generationQuota(request)).used).toBe(0);
  });

  it.each([[401, "meta_unauthorized"], [403, "meta_forbidden"], [500, "meta_unavailable"]])("refuses HTTP %i without exposing provider details", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "private provider detail" }, { status: Number(status) })));
    await expect(assertModelsAvailable(["image"])).rejects.toMatchObject({ code });
  });

  it("fails closed for malformed catalog responses or connection failures", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [null] })).mockRejectedValueOnce(new Error("private connection detail"));
    vi.stubGlobal("fetch", fetcher);
    await expect(assertModelsAvailable(["image"])).rejects.toMatchObject({ code: "meta_unavailable" });
    await expect(assertModelsAvailable(["image"])).rejects.toMatchObject({ code: "meta_unreachable" });
  });
});
