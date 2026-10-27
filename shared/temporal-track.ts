import type { Box, Tracking } from "./tracking";

// Time Freeze reads the segmentation v1 already stored: the job's SAM 3.1
// tracking, its object ids and its frame indices. Nothing here segments or
// guesses; it only summarizes the selected objects frame by frame, and says
// when the masks are too thin to build an honest freeze.

/** The selected subject at one frame of the normalized video. */
export type TrackPoint = {
  readonly frameIndex: number;
  /** Seconds, from the frame index and the clip's frame rate. */
  readonly timestamp: number;
  /** Union box of the selected objects, half-open, in source pixels. */
  readonly box: Box;
  readonly center: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  /** True when at least one selected object has a real mask here, not only a box. */
  readonly masked: boolean;
  /** Lowest confidence among the selected objects, when SAM reported one. */
  readonly confidence: number | null;
};

/** One point per frame where a selected object was tracked, sorted by frame index. Missing frames stay missing. */
export function selectionTrack(tracking: Tracking, selection: readonly string[]): TrackPoint[] {
  const chosen = new Set(selection);
  const track: TrackPoint[] = [];
  for (const frame of tracking.frames) {
    let box: Box | null = null;
    let masked = false;
    let confidence: number | null = null;
    for (const object of frame.objects) {
      if (!chosen.has(object.objectId)) continue;
      const b = object.box;
      if (b.right <= b.left || b.bottom <= b.top) continue;
      box = box
        ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) }
        : { ...b };
      masked ||= object.mask !== null;
      if (object.confidence !== null) confidence = confidence === null ? object.confidence : Math.min(confidence, object.confidence);
    }
    if (!box) continue;
    track.push({
      frameIndex: frame.frameIndex,
      timestamp: frame.timestamp,
      box,
      center: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
      width: box.right - box.left,
      height: box.bottom - box.top,
      masked,
      confidence,
    });
  }
  return track;
}

/** Below this, SAM's own confidence is too low to cut the subject out. */
export const MIN_ECHO_CONFIDENCE = 0.5;

export type TemporalTrackingCheck = {
  /** Set when the freeze cannot be rendered honestly from these masks. */
  readonly error: string | null;
  readonly warnings: readonly string[];
  /** The requested sample frames that have a usable mask, in the order given. */
  readonly usableSamples: readonly number[];
};

/**
 * Checks the stored masks before a freeze is rendered. The frozen frame must
 * have the subject's mask (its silhouette is drawn back on top), and at least
 * two echo moments must have one; anything weaker is reported, never hidden.
 */
export function checkTemporalTracking(
  track: readonly TrackPoint[],
  input: { readonly triggerFrame: number; readonly sampleFrames: readonly number[] },
): TemporalTrackingCheck {
  const byFrame = new Map(track.map((point) => [point.frameIndex, point]));
  const usable = (frameIndex: number) => {
    const point = byFrame.get(frameIndex);
    return Boolean(point?.masked && (point.confidence === null || point.confidence >= MIN_ECHO_CONFIDENCE));
  };
  const usableSamples = input.sampleFrames.filter(usable);
  const warnings: string[] = [];

  if (!usable(input.triggerFrame)) {
    return {
      error: "The subject isn’t tracked at the freeze point. Move the freeze point to a moment where it is visible, or complete the tracking.",
      warnings,
      usableSamples,
    };
  }
  if (usableSamples.length < 2) {
    return {
      error: "The subject isn’t tracked in enough moments before the freeze point to build echoes. Move the freeze point later or complete the tracking.",
      warnings,
      usableSamples,
    };
  }
  const skipped = input.sampleFrames.length - usableSamples.length;
  if (skipped > 0) warnings.push(`${skipped} of ${input.sampleFrames.length} echo moments have no reliable mask and were left out.`);
  return { error: null, warnings, usableSamples };
}
