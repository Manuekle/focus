import { describe, expect, it } from "vitest";
import { backgroundBlur, blendOver, cropGhost, drawGhost, luma, selectiveColor, trailOpacity } from "./effects";
import { computeBreakFrameLayout, subjectMotion, visibleSourceRect } from "./layout";
import { feather } from "./masks";

// Synthetic frames: a red square subject on a blue background.

const W = 64;
const H = 48;
const SUBJECT = { left: 20, top: 12, right: 44, bottom: 36 };
const RED = [220, 30, 40];
const BLUE = [30, 60, 210];

function scene(): { frame: Buffer; alpha: Uint8Array } {
  const frame = Buffer.alloc(W * H * 4);
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= SUBJECT.left && x < SUBJECT.right && y >= SUBJECT.top && y < SUBJECT.bottom;
      const [r, g, b] = inside ? RED : BLUE;
      const p = (y * W + x) * 4;
      frame[p] = r;
      frame[p + 1] = g;
      frame[p + 2] = b;
      frame[p + 3] = 255;
      alpha[y * W + x] = inside ? 255 : 0;
    }
  }
  return { frame, alpha };
}

const px = (buffer: Buffer, x: number, y: number) => [...buffer.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
const isGray = ([r, g, b]: number[]) => Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1;

describe("Reality Shift · selective color", () => {
  it("keeps the subject's color and turns the background gray", () => {
    const { frame, alpha } = scene();
    const out = selectiveColor(frame, alpha, 1);
    expect(px(out, 32, 24)).toEqual(RED);
    expect(isGray(px(out, 2, 2))).toBe(true);
    expect(px(out, 2, 2)[0]).toBe(Math.round(luma(BLUE[0], BLUE[1], BLUE[2])));
  });

  it("scales desaturation with intensity", () => {
    const { frame, alpha } = scene();
    const half = px(selectiveColor(frame, alpha, 0.5), 2, 2);
    const y = luma(BLUE[0], BLUE[1], BLUE[2]);
    expect(half[2]).toBe(Math.round(BLUE[2] + (y - BLUE[2]) * 0.5));
  });

  it("blends across a feathered edge without moving it", () => {
    const { frame, alpha } = scene();
    const soft = feather(alpha, W, H, 2);
    // The 50% point stays on SAM's boundary: no halo grows outward.
    expect(soft[24 * W + SUBJECT.left - 1]).toBeLessThan(128);
    expect(soft[24 * W + SUBJECT.left]).toBeGreaterThanOrEqual(128);
    expect(soft[24 * W + 10]).toBe(0);
    const out = selectiveColor(frame, soft, 1);
    expect(isGray(px(out, 10, 24))).toBe(true);
    expect(px(out, 32, 24)).toEqual(RED);
  });
});

describe("Reality Shift · background blur", () => {
  it("keeps the subject sharp and never smears its color into the background", async () => {
    const { frame, alpha } = scene();
    const out = await backgroundBlur(frame, alpha, W, H, 4);
    expect(px(out, 32, 24)).toEqual(RED);
    // Just outside the subject the background stays blue, not reddish.
    const [r, , b] = px(out, SUBJECT.left - 2, 24);
    expect(b).toBeGreaterThan(180);
    expect(r).toBeLessThan(60);
  });

  it("actually blurs the background", async () => {
    const { frame } = scene();
    // Background with an edge of its own: left half black, right half white.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) frame.fill(x < 32 ? 0 : 255, (y * W + x) * 4, (y * W + x) * 4 + 3);
    const out = await backgroundBlur(frame, new Uint8Array(W * H), W, H, 3);
    expect(px(out, 31, 24)[0]).toBeGreaterThan(40);
    expect(px(out, 32, 24)[0]).toBeLessThan(215);
  });
});

describe("Motion Echo", () => {
  it("uses deterministic, decreasing opacities", () => {
    expect([1, 2, 3].map((k) => trailOpacity(k, 3, 0.6))).toEqual([0.6, 0.4, 0.2].map((value) => expect.closeTo(value, 10)));
  });

  it("redraws a past subject at its old position through its own mask", () => {
    const { frame, alpha } = scene();
    const ghost = cropGhost(frame, alpha, SUBJECT, W);
    const base = Buffer.alloc(W * H * 4, 0);
    drawGhost(base, ghost, 0.5, W);
    expect(px(base, 32, 24)).toEqual(RED.map((value) => Math.round(value * 0.5)));
    // Outside the ghost's mask nothing is drawn, even inside its box.
    expect(px(base, 2, 2)).toEqual([0, 0, 0]);
  });

  it("keeps the current subject fully visible above its trail", () => {
    const { frame, alpha } = scene();
    const out = Buffer.alloc(W * H * 4, 0);
    blendOver(out, frame, alpha, 1, SUBJECT, W);
    expect(px(out, 32, 24)).toEqual(RED);
  });
});

describe("Break the Frame layout", () => {
  const source = { width: 1280, height: 720 };
  const canvas = { width: 1080, height: 1350 };

  it("always covers the inner frame with video", () => {
    for (const subject of [
      { left: 500, top: 100, right: 700, bottom: 400 },
      { left: 100, top: 400, right: 300, bottom: 700 },
      { left: 1000, top: 300, right: 1270, bottom: 710 },
    ]) {
      const layout = computeBreakFrameLayout({ source, canvas, frameSize: "balanced", subject: { typical: subject, extent: subject } });
      const { scale, offsetX, offsetY } = layout.transform;
      expect(offsetX).toBeLessThanOrEqual(layout.frame.x);
      expect(offsetY).toBeLessThanOrEqual(layout.frame.y);
      expect(offsetX + source.width * scale).toBeGreaterThanOrEqual(layout.frame.x + layout.frame.width - 1);
      expect(offsetY + source.height * scale).toBeGreaterThanOrEqual(layout.frame.y + layout.frame.height - 1);
    }
  });

  it("cuts the frame edge through the subject on its nearest side", () => {
    const low = { left: 500, top: 380, right: 700, bottom: 700 };
    const layout = computeBreakFrameLayout({ source, canvas, frameSize: "balanced", subject: { typical: low, extent: low } });
    expect(layout.direction).toBe("bottom");
    const { scale, offsetY } = layout.transform;
    const subjectBottom = offsetY + low.bottom * scale;
    const subjectTop = offsetY + low.top * scale;
    const frameBottom = layout.frame.y + layout.frame.height;
    expect(subjectBottom).toBeGreaterThan(frameBottom);
    expect(subjectTop).toBeLessThan(frameBottom);
    // And there is canvas below the frame to show the breakout on.
    expect(visibleSourceRect(layout, source).y + visibleSourceRect(layout, source).height).toBeGreaterThan(frameBottom);
  });

  it("breaks out of the top for a subject high in the frame", () => {
    const high = { left: 500, top: 20, right: 700, bottom: 300 };
    const layout = computeBreakFrameLayout({ source, canvas, frameSize: "balanced", subject: { typical: high, extent: high } });
    expect(layout.direction).toBe("top");
    expect(layout.transform.offsetY + high.top * layout.transform.scale).toBeLessThan(layout.frame.y);
  });

  it("summarizes motion with robust percentiles", () => {
    const boxes = Array.from({ length: 20 }, (_, index) => ({ left: index * 10, top: 100, right: index * 10 + 50, bottom: 200 }));
    boxes.push({ left: 5000, top: 5000, right: 6000, bottom: 6000 });
    const motion = subjectMotion(boxes)!;
    expect(motion.extent.right).toBeLessThan(1000);
    expect(motion.typical.top).toBe(100);
  });
});
