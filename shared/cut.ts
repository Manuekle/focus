import { z } from "zod";

// The video editor's cut list: the parts of the clip that stay, in source
// seconds, sorted and never overlapping. The timeline edits it without
// touching the file; applying it asks the server for a new, shorter clip
// (server/videos.ts → cutVideo), so every later stage reads only what stays.

/** Shortest part worth keeping: about two frames at 24 fps. */
export const MIN_SEGMENT_SECONDS = 0.08;
export const MAX_SEGMENTS = 50;

export const CutSegmentSchema = z.object({ start: z.number().nonnegative(), end: z.number().positive() }).refine((segment) => segment.end - segment.start >= MIN_SEGMENT_SECONDS - 1e-6, "Segment too short");
export type CutSegment = z.infer<typeof CutSegmentSchema>;

export const CutRequestSchema = z.object({ keep: z.array(CutSegmentSchema).min(1).max(MAX_SEGMENTS) });

/** Sorted, merged where they touch or overlap, clamped to the clip, short leftovers dropped. */
export function normalizeCut(segments: readonly CutSegment[], duration: number): CutSegment[] {
  const sorted = segments
    .map((segment) => ({ start: Math.max(0, Math.min(duration, segment.start)), end: Math.max(0, Math.min(duration, segment.end)) }))
    .filter((segment) => segment.end - segment.start >= MIN_SEGMENT_SECONDS - 1e-6)
    .sort((a, b) => a.start - b.start);
  const merged: CutSegment[] = [];
  for (const segment of sorted) {
    const last = merged.at(-1);
    if (last && segment.start <= last.end + 1e-6) last.end = Math.max(last.end, segment.end);
    else merged.push({ ...segment });
  }
  return merged;
}

export function wholeClip(duration: number): CutSegment[] {
  return [{ start: 0, end: duration }];
}

/** True when the cut keeps the clip as it is (split points alone remove nothing): nothing to apply. */
export function isWhole(segments: readonly CutSegment[], duration: number): boolean {
  return segments.length > 0 && segments[0].start <= 1e-3 && segments.at(-1)!.end >= duration - 1e-3 && segments.every((segment, index) => index === 0 || segment.start <= segments[index - 1].end + 1e-3);
}

export function keptSeconds(segments: readonly CutSegment[]): number {
  return segments.reduce((total, segment) => total + segment.end - segment.start, 0);
}

export function segmentAt(segments: readonly CutSegment[], time: number): number {
  return segments.findIndex((segment) => time >= segment.start - 1e-6 && time < segment.end - 1e-6);
}

/** Splits the part under `time` in two. Unchanged when `time` is in a gap or too close to an edge. */
export function splitAt(segments: readonly CutSegment[], time: number): CutSegment[] {
  const index = segmentAt(segments, time);
  if (index < 0) return [...segments];
  const { start, end } = segments[index];
  if (time - start < MIN_SEGMENT_SECONDS || end - time < MIN_SEGMENT_SECONDS || segments.length >= MAX_SEGMENTS) return [...segments];
  return [...segments.slice(0, index), { start, end: time }, { start: time, end }, ...segments.slice(index + 1)];
}

/** Drops one part. The last part can't go: a clip needs at least one. */
export function removeSegment(segments: readonly CutSegment[], index: number): CutSegment[] {
  if (segments.length <= 1 || index < 0 || index >= segments.length) return [...segments];
  return segments.filter((_, at) => at !== index);
}

/**
 * Moves one edge of a part, bounded by its neighbours, the clip, and the
 * minimum length.
 */
export function trimEdge(segments: readonly CutSegment[], index: number, edge: "start" | "end", time: number, duration: number): CutSegment[] {
  const segment = segments[index];
  if (!segment) return [...segments];
  const next = { ...segment };
  if (edge === "start") {
    const floor = index > 0 ? segments[index - 1].end : 0;
    next.start = Math.max(floor, Math.min(segment.end - MIN_SEGMENT_SECONDS, time));
  } else {
    const ceiling = index < segments.length - 1 ? segments[index + 1].start : duration;
    next.end = Math.min(ceiling, Math.max(segment.start + MIN_SEGMENT_SECONDS, time));
  }
  return segments.map((entry, at) => (at === index ? next : entry));
}

/**
 * Where playback should be: `time` itself inside a part, otherwise the start
 * of the next part, wrapping to the first one past the end.
 */
export function playableTime(segments: readonly CutSegment[], time: number): number {
  if (!segments.length || segmentAt(segments, time) >= 0) return time;
  return (segments.find((segment) => segment.start > time) ?? segments[0]).start;
}

/** Snaps `time` to the nearest frame. */
export function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps;
}
