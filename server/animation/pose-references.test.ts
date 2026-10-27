import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoseId } from "../../shared/pose-library";
import { loadPoseReference } from "./pose-references";

let dir: string;
const poseId = "full_single_P061_side";
const png = () => sharp({ create: { width: 32, height: 48, channels: 3, background: "#808080" } }).png().toBuffer();

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "focus-pose-"));
  vi.stubEnv("FOCUS_DATA_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("private pose references", () => {
  it("downloads only the fixed gallery PNG and reuses its validated private cache", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(await png()), { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetcher);
    const first = await loadPoseReference(poseId);
    const second = await loadPoseReference(poseId);
    expect(first.equals(second)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://ai-pose-gallery.pages.dev/img/${poseId}.png`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect((await sharp(first).metadata()).format).toBe("png");
  });

  it("rejects unknown IDs, paths and URLs without fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const id of ["../../secret", "https://example.com/a.png", "full_single_P999_side"]) {
      await expect(loadPoseReference(id as PoseId)).rejects.toMatchObject({ code: "invalid_pose" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects errors, non-images and falsely declared PNGs", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
      new Response("not a PNG", { headers: { "Content-Type": "image/png" } }),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(loadPoseReference(poseId)).rejects.toMatchObject({ code: "pose_unavailable" });
    }
  });

  it("bounds streamed bytes even when the server understates the length", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "image/png", "Content-Length": "1" } })));
    await expect(loadPoseReference(poseId)).rejects.toMatchObject({ code: "pose_unavailable" });
  });

  it("honors cancellation before a request starts", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(loadPoseReference(poseId, AbortSignal.abort())).rejects.toMatchObject({ code: "canceled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
