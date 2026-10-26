import type { Box } from "../../shared/tracking";

// Break the Frame geometry. One transform maps source pixels to canvas pixels
// for BOTH the clipped video and the unclipped subject, so the two layers can
// never drift apart.

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type Transform = { readonly scale: number; readonly offsetX: number; readonly offsetY: number };
export type BreakFrameLayout = {
  readonly canvas: { readonly width: number; readonly height: number };
  /** The inner frame; background video is clipped to it. */
  readonly frame: Rect;
  /** source → canvas: canvas = source × scale + offset. */
  readonly transform: Transform;
};

export const FRAME_SIZES = {
  compact: { width: 0.7, height: 0.6 },
  balanced: { width: 0.8, height: 0.66 },
  wide: { width: 0.88, height: 0.72 },
} as const;

/** Where a subject typically is (median box) and how far it travels (10th–90th percentile extent). */
export type SubjectMotion = { readonly typical: Box; readonly extent: Box };

function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/** Per-axis median of boxes: a stable "typical" subject box for a moving subject. */
export function medianBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return {
    left: percentile(boxes.map((box) => box.left), 0.5),
    top: percentile(boxes.map((box) => box.top), 0.5),
    right: percentile(boxes.map((box) => box.right), 0.5),
    bottom: percentile(boxes.map((box) => box.bottom), 0.5),
  };
}

export function subjectMotion(boxes: readonly Box[]): SubjectMotion | null {
  const typical = medianBox(boxes);
  if (!typical) return null;
  // Percentiles, not min/max: one stray detection must not stretch the layout.
  return {
    typical,
    extent: {
      left: percentile(boxes.map((box) => box.left), 0.1),
      top: percentile(boxes.map((box) => box.top), 0.1),
      right: percentile(boxes.map((box) => box.right), 0.9),
      bottom: percentile(boxes.map((box) => box.bottom), 0.9),
    },
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Places the inner frame on the canvas and chooses the source transform.
 *
 * - The video always covers the inner frame: no empty corners.
 * - Zoom fits the subject's path across the frame's width when it can, and
 *   grows just enough for the frame edge to cut through the subject; it never
 *   exceeds 2.2× the cover scale.
 * - The frame edge nearest the subject (top for a subject in the upper half of
 *   the source, bottom otherwise) is moved so it cuts through the subject: the
 *   part of the subject past that edge is drawn on the canvas, unclipped. That
 *   strip of real pixels is the breakout.
 */
export function computeBreakFrameLayout(input: {
  readonly source: { readonly width: number; readonly height: number };
  readonly canvas: { readonly width: number; readonly height: number };
  readonly frameSize: keyof typeof FRAME_SIZES;
  readonly subject: SubjectMotion | null;
}): BreakFrameLayout & { readonly direction: "top" | "bottom" } {
  const { source, canvas } = input;
  const whole = { left: 0, top: 0, right: source.width, bottom: source.height };
  const typical = input.subject?.typical ?? whole;
  const extent = input.subject?.extent ?? whole;
  const direction = (extent.top + extent.bottom) / 2 < source.height / 2 ? "top" : "bottom";
  const size = FRAME_SIZES[input.frameSize];
  const frameWidth = Math.round(canvas.width * size.width);
  const frameHeight = Math.round(canvas.height * size.height);
  const frame: Rect = {
    x: Math.round((canvas.width - frameWidth) / 2),
    // Off-center, leaving room on the side the subject breaks out of.
    y: Math.round(canvas.height * (direction === "top" ? 0.58 : 0.42) - frameHeight / 2),
    width: frameWidth,
    height: frameHeight,
  };

  const cover = Math.max(frame.width / source.width, frame.height / source.height);
  const subjectHeight = Math.max(1, typical.bottom - typical.top);
  const pathWidth = Math.max(1, extent.right - extent.left);
  const fit = Math.min((frame.width * 0.95) / pathWidth, (frame.height * 0.9) / subjectHeight);
  // The frame edge can only cut through the subject if the video still covers
  // the frame on the other side: that needs at least this zoom.
  const reach = direction === "top" ? source.height - typical.top : typical.bottom;
  const toCut = frame.height / Math.max(1, reach - subjectHeight * 0.35);
  const scale = clamp(Math.max(fit, toCut), cover, cover * 2.2);

  const scaledWidth = source.width * scale;
  const scaledHeight = source.height * scale;
  const pathCenterX = (extent.left + extent.right) / 2;
  const offsetX = clamp(frame.x + frame.width / 2 - pathCenterX * scale, frame.x + frame.width - scaledWidth, frame.x);
  // Cut through the subject about a third of its height from the breakout side.
  const cut = subjectHeight * scale * 0.35;
  const offsetY =
    direction === "top"
      ? // frame top lands `cut` below the subject's typical top
        clamp(frame.y - cut - typical.top * scale, frame.y + frame.height - scaledHeight, frame.y)
      : // frame bottom lands `cut` above the subject's typical bottom
        clamp(frame.y + frame.height + cut - typical.bottom * scale, frame.y + frame.height - scaledHeight, frame.y);
  return { canvas, frame, direction, transform: { scale, offsetX: Math.round(offsetX), offsetY: Math.round(offsetY) } };
}

/** The canvas-space rectangle covered by the transformed source, clipped to the canvas. */
export function visibleSourceRect(layout: BreakFrameLayout, source: { readonly width: number; readonly height: number }): Rect {
  const { scale, offsetX, offsetY } = layout.transform;
  const left = Math.max(0, offsetX);
  const top = Math.max(0, offsetY);
  const right = Math.min(layout.canvas.width, Math.round(offsetX + source.width * scale));
  const bottom = Math.min(layout.canvas.height, Math.round(offsetY + source.height * scale));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function insideRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
