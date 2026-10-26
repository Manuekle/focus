import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVideoStream, type ResponsesEvent } from "@meta-sam/parser";
import { buildTracking, frameAt, hitTest, mergeTracking } from "../../shared/tracking";
import { promptText } from "./sam";

// Fixtures are real SAM 3.1 output recorded from the Meta API on a 4 s,
// 1280×674, 24 fps normalized clip (96 frames). No network in these tests.

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");
const BRIDGE = fixture("bridge-96f.sam.txt");
const ROCKS = fixture("rock-12f.sam.txt");
const MEDIA = { width: 1280, height: 674, fps: 24, frameCount: 96 };

/** Replays output text as Responses events, split into arbitrary chunks. */
async function* events(text: string, chunk = 977): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "msg", output_index: 0, content_index: 0 };
  for (let index = 0; index < text.length; index += chunk) {
    yield { type: "response.output_text.delta", delta: text.slice(index, index + chunk), ...lane };
  }
  yield { type: "response.output_text.done", text, ...lane };
  yield { type: "response.completed" };
}

async function track(text: string, chunk?: number) {
  const result = await parseVideoStream(events(text, chunk)).finalResult;
  return buildTracking({
    id: "test",
    videoId: "video",
    source: "concept",
    prompt: "fixture",
    ...MEDIA,
    records: result.records,
    diagnostics: result.diagnostics,
    outcome: result.outcome,
    videoFramesProcessed: 96,
  });
}

describe("SAM stream → tracking", () => {
  it("parses a single tracked object across every frame", async () => {
    const tracking = await track(BRIDGE);
    expect(tracking.outcome.status).toBe("completed");
    expect(tracking.diagnostics).toEqual([]);
    expect(tracking.frames).toHaveLength(96);
    expect(tracking.objects).toEqual([expect.objectContaining({ id: "0", framesPresent: 96, firstFrame: 0, lastFrame: 95 })]);
    expect(tracking.missingFrames).toEqual([]);
    const first = tracking.frames[0].objects[0];
    expect(first.mask).not.toBeNull();
    expect(first.box.right).toBeLessThanOrEqual(1280);
    expect(first.box.bottom).toBeLessThanOrEqual(674);
    expect(tracking.frames[10].timestamp).toBeCloseTo(10 / 24);
  });

  it("keeps several objects with stable string ids", async () => {
    const tracking = await track(ROCKS);
    expect(tracking.objects.length).toBeGreaterThan(5);
    expect(new Set(tracking.objects.map((object) => object.id)).size).toBe(tracking.objects.length);
    expect(tracking.frames.map((frame) => frame.frameIndex)).toEqual([...Array(12).keys()]);
  });

  it("is independent of how deltas are split", async () => {
    const coarse = await track(BRIDGE, 50_000);
    const fine = await track(BRIDGE, 13);
    expect(fine.frames).toEqual(coarse.frames);
  });

  it("orders frames by index even when SAM streams them backwards", async () => {
    const lines = BRIDGE.split("\n").filter(Boolean);
    const shuffled = [...lines.slice(48), ...lines.slice(0, 48).reverse()].join("\n") + "\n";
    const ordered = await track(BRIDGE);
    const reordered = await track(shuffled);
    expect(reordered.frames.map((frame) => frame.frameIndex)).toEqual(ordered.frames.map((frame) => frame.frameIndex));
    expect(reordered.frames).toEqual(ordered.frames);
  });

  it("reports frames with no detection as missing", async () => {
    const lines = BRIDGE.split("\n").filter(Boolean);
    const gapped = lines.filter((_, index) => index < 10 || index > 12).join("\n") + "\n";
    const tracking = await track(gapped);
    expect(tracking.missingFrames).toEqual([10, 11, 12]);
    expect(frameAt(tracking, 11)).toBeUndefined();
    expect(tracking.objects[0].framesPresent).toBe(93);
  });

  it("treats an empty response as zero objects, not an error", async () => {
    const tracking = await track("");
    expect(tracking.outcome.status).toBe("completed");
    expect(tracking.objects).toEqual([]);
    expect(tracking.frames).toEqual([]);
  });

  it("marks a stream that ends early as incomplete", async () => {
    async function* truncated(): AsyncIterable<ResponsesEvent> {
      yield { type: "response.output_text.delta", delta: BRIDGE.split("\n")[0] + "\n", item_id: "m", output_index: 0, content_index: 0 };
    }
    const result = await parseVideoStream(truncated()).finalResult;
    expect(result.outcome).toEqual({ status: "incomplete", reason: "eof" });
  });

  it("drops records that point past the last frame", async () => {
    const tracking = buildTracking({
      id: "x", videoId: "v", source: "concept", prompt: "p", ...MEDIA, frameCount: 5,
      records: (await parseVideoStream(events(BRIDGE)).finalResult).records,
      diagnostics: [], outcome: { status: "completed" }, videoFramesProcessed: null,
    });
    expect(tracking.frames.map((frame) => frame.frameIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("hit testing", () => {
  it("selects the object whose mask covers the point, not just its box", async () => {
    const tracking = await track(BRIDGE);
    const frame = frameAt(tracking, 0)!;
    const { left, top, right, bottom } = frame.objects[0].box;
    // The bridge tower is inside the box; the sky in the box's top-left corner is not.
    expect(hitTest(frame, left + 1, top + 1)).toBeNull();
    let inside: string | null = null;
    for (let x = left; x < right && !inside; x += 8) inside = hitTest(frame, x, Math.floor((top + bottom) / 2));
    expect(inside).toBe("0");
    expect(hitTest(frame, 5, 5)).toBeNull();
  });

  it("merges point-prompt objects without disturbing concept objects", async () => {
    const base = await track(BRIDGE);
    const rocks = await track(ROCKS);
    const extra = { ...rocks, objects: rocks.objects.slice(0, 1).map((object) => ({ ...object, id: "100" })) };
    const merged = mergeTracking(base, extra);
    expect(merged.objects.map((object) => object.id)).toEqual(["0", "100"]);
    expect(merged.frames).toHaveLength(96);
  });
});

describe("SAM prompts", () => {
  it("sends concepts as bare noun phrases", () => {
    expect(promptText({ kind: "concept", concept: "red car" }, { ...MEDIA, durationSeconds: 4, codec: "h264", hasAudio: false })).toBe("red car");
  });

  it("builds a documented point prompt in normalized pixels", () => {
    const text = promptText(
      { kind: "point", objectId: 100, frameIndex: 30, point: { x: 640, y: 337 } },
      { ...MEDIA, durationSeconds: 4, codec: "h264", hasAudio: false },
    );
    expect(text).toBe("<30f>100<|point;x=640;y=337;w=1280;h=674|>");
  });
});
