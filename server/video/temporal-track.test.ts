import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVideoStream, type ResponsesEvent } from "@meta-sam/parser";
import { checkTemporalTracking, selectionTrack, type TrackPoint } from "../../shared/temporal-track";
import { buildTracking, frameAt, type Tracking, type TrackingFrame } from "../../shared/tracking";
import { trackingMaskSource } from "./compositor";

// Time Freeze reuses the stored SAM tracking: real recorded SAM 3.1 output is
// replayed here, and the summaries must line up with the masks the renderer
// rasterizes for the same frame index.

const MEDIA = { width: 1280, height: 674, fps: 24, frameCount: 96 };
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "..", "ai", "__fixtures__", name), "utf8");

async function* replay(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  yield { type: "response.output_text.delta", delta: text, ...lane };
  yield { type: "response.output_text.done", text, ...lane };
  yield { type: "response.completed" };
}

async function recorded(name: string): Promise<Tracking> {
  const result = await parseVideoStream(replay(fixture(name))).finalResult;
  return buildTracking({
    id: "c-test", videoId: "video", source: "concept", prompt: "fixture", ...MEDIA,
    records: result.records, diagnostics: result.diagnostics, outcome: result.outcome, videoFramesProcessed: 96,
  });
}

const media = { ...MEDIA, durationSeconds: 4, codec: "h264" as const, hasAudio: false };

describe("selection track from stored SAM masks", () => {
  it("keeps SAM's frame indices, timestamps and object identity", async () => {
    const tracking = await recorded("bridge-96f.sam.txt");
    const track = selectionTrack(tracking, ["0"]);
    expect(track.length).toBe(tracking.frames.length);
    expect(track.map((point) => point.frameIndex)).toEqual(tracking.frames.map((frame) => frame.frameIndex));
    for (const point of track) {
      expect(point.timestamp).toBeCloseTo(point.frameIndex / MEDIA.fps, 9);
      expect(point.masked).toBe(true);
      expect(point.center.x).toBe((point.box.left + point.box.right) / 2);
    }
  });

  it("describes the same pixels the renderer cuts out at each frame index", async () => {
    const tracking = await recorded("bridge-96f.sam.txt");
    const masks = trackingMaskSource(tracking, ["0"], media);
    for (const point of selectionTrack(tracking, ["0"]).filter((_, index) => index % 12 === 0)) {
      const alpha = masks.alphaAt(point.frameIndex);
      expect(alpha.box).not.toBeNull();
      // Every mask pixel lies inside the track box for that very frame.
      let inside = 0;
      for (let i = 0; i < alpha.data.length; i++) {
        if (!alpha.data[i]) continue;
        const x = i % MEDIA.width;
        const y = Math.floor(i / MEDIA.width);
        expect(x >= point.box.left && x < point.box.right && y >= point.box.top && y < point.box.bottom).toBe(true);
        inside++;
      }
      expect(inside).toBeGreaterThan(0);
    }
  });

  it("unions only the selected objects", async () => {
    const tracking = await recorded("rock-12f.sam.txt");
    const ids = tracking.objects.map((object) => object.id);
    expect(ids.length).toBeGreaterThan(1);
    const one = selectionTrack(tracking, [ids[0]]);
    const all = selectionTrack(tracking, ids);
    const first = one[0];
    const union = all.find((point) => point.frameIndex === first.frameIndex)!;
    expect(union.width * union.height).toBeGreaterThanOrEqual(first.width * first.height);
    const frame = frameAt(tracking, first.frameIndex)!;
    expect(first.box).toEqual(frame.objects.find((object) => object.objectId === ids[0])!.box);
    expect(selectionTrack(tracking, ["999"])).toEqual([]);
  });
});

function frame(frameIndex: number, options: { mask?: boolean; confidence?: number | null } = {}): TrackingFrame {
  return {
    frameIndex,
    timestamp: frameIndex / 24,
    objects: [
      {
        objectId: "0",
        box: { left: 10, top: 10, right: 30, bottom: 50 },
        confidence: options.confidence ?? 0.9,
        mask: options.mask === false ? null : { encoding: "one_bit", payload: "", width: 20, height: 40 },
      },
    ],
  };
}

function trackOf(frames: TrackingFrame[]): TrackPoint[] {
  return selectionTrack({ ...({} as Tracking), frames }, ["0"]);
}

describe("tracking check before a freeze", () => {
  it("passes when the freeze frame and the echo moments are masked", () => {
    const track = trackOf([frame(0), frame(4), frame(8), frame(12)]);
    expect(checkTemporalTracking(track, { triggerFrame: 12, sampleFrames: [0, 4, 8] })).toEqual({ error: null, warnings: [], usableSamples: [0, 4, 8] });
  });

  it("refuses a freeze point where the subject has no mask", () => {
    const track = trackOf([frame(0), frame(4), frame(8), frame(12, { mask: false })]);
    expect(checkTemporalTracking(track, { triggerFrame: 12, sampleFrames: [0, 4, 8] }).error).toMatch(/freeze point/);
    expect(checkTemporalTracking(track, { triggerFrame: 20, sampleFrames: [0, 4, 8] }).error).toMatch(/freeze point/);
  });

  it("refuses when fewer than two echo moments are usable", () => {
    const track = trackOf([frame(0, { confidence: 0.2 }), frame(8), frame(12)]);
    expect(checkTemporalTracking(track, { triggerFrame: 12, sampleFrames: [0, 4, 8] }).error).toMatch(/enough moments/);
  });

  it("skips unreliable moments and says so", () => {
    const track = trackOf([frame(0), frame(2, { confidence: 0.3 }), frame(4), frame(8), frame(12)]);
    const check = checkTemporalTracking(track, { triggerFrame: 12, sampleFrames: [0, 2, 4, 6, 8] });
    expect(check.error).toBeNull();
    expect(check.usableSamples).toEqual([0, 4, 8]);
    expect(check.warnings).toEqual(["2 of 5 echo moments have no reliable mask and were left out."]);
  });

  it("never treats a box without a mask as a cutout", () => {
    const track = trackOf([frame(0, { mask: false }), frame(4, { mask: false }), frame(12)]);
    expect(track[0].masked).toBe(false);
    expect(checkTemporalTracking(track, { triggerFrame: 12, sampleFrames: [0, 4] }).error).toMatch(/enough moments/);
  });
});
