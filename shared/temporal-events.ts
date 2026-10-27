import { z } from "zod";
import { TriggerEventSchema, type TriggerEvent } from "./temporal";
import { MIN_ECHO_CONFIDENCE, type TrackPoint } from "./temporal-track";

// Geometry suggests a moment; it does not recognize human actions. Confidence
// is an evidence score, not a calibrated probability that a person jumped.
export const MIN_EVENT_CONFIDENCE = 0.7;

export const TemporalSuggestionSchema = z.object({
  event: TriggerEventSchema,
  frameIndex: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
});
export type TemporalSuggestion = z.infer<typeof TemporalSuggestionSchema>;

type Media = { readonly fps: number; readonly frameCount: number };
type Point = { readonly frameIndex: number; readonly x: number; readonly y: number; readonly height: number; readonly size: number; readonly confidence: number };
type Candidate = { readonly point: Point; readonly confidence: number; readonly strength: number; readonly reason: string };

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)]) / 2;
};
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) / ((a.size + b.size) / 2);

/** Never bridge a missing/unreliable frame, a scale discontinuity or a teleport. */
function segmentsOf(track: readonly TrackPoint[], media: Media): Point[][] {
  const segments: Point[][] = [];
  let segment: Point[] = [];
  let previous: TrackPoint | undefined;
  for (const point of [...track].sort((a, b) => a.frameIndex - b.frameIndex)) {
    const valid = Number.isInteger(point.frameIndex) && point.frameIndex >= 0 && point.frameIndex < media.frameCount &&
      Number.isFinite(point.center.x) && Number.isFinite(point.center.y) &&
      Number.isFinite(point.width) && point.width > 0 && Number.isFinite(point.height) && point.height > 0 &&
      point.masked && (point.confidence === null || (Number.isFinite(point.confidence) && point.confidence >= MIN_ECHO_CONFIDENCE && point.confidence <= 1));
    if (!valid) {
      previous = undefined;
      segment = [];
      continue;
    }
    const next: Point = { frameIndex: point.frameIndex, x: point.center.x, y: point.center.y, height: point.height, size: Math.hypot(point.width, point.height), confidence: point.confidence ?? 0.75 };
    const last = segment.at(-1);
    const continuous = previous && last && point.frameIndex === previous.frameIndex + 1 &&
      Math.max(point.width / previous.width, previous.width / point.width, point.height / previous.height, previous.height / point.height) <= 1.5 &&
      distance(last, next) <= 0.75 * 24 / media.fps;
    if (!continuous) {
      segment = [];
      segments.push(segment);
    }
    segment.push(next);
    previous = point;
  }
  return segments;
}

function smooth(points: readonly Point[], radius: number): Point[] {
  return points.map((point, index) => {
    const window = points.slice(Math.max(0, index - radius), index + radius + 1);
    return { ...point, x: median(window.map((p) => p.x)), y: median(window.map((p) => p.y)) };
  });
}

/** Minimum screen y is the highest point. Both sides must move by subject height. */
function jumpCandidates(points: readonly Point[], fps: number): Candidate[] {
  const candidates: Candidate[] = [];
  const reach = Math.ceil(fps * 1.5);
  const shoulder = Math.max(2, Math.ceil(fps * 0.12));
  for (let i = shoulder; i < points.length - shoulder; i++) {
    const apex = points[i];
    if (apex.y > points[i - 1].y || apex.y > points[i + 1].y) continue;
    const start = Math.max(0, i - reach);
    const end = Math.min(points.length - 1, i + reach);
    let before = i - shoulder;
    let after = i + shoulder;
    for (let j = start; j <= i - shoulder; j++) if (points[j].y > points[before].y) before = j;
    for (let j = i + shoulder; j <= end; j++) if (points[j].y > points[after].y) after = j;
    const window = points.slice(before, after + 1);
    const height = median(window.map((point) => point.height));
    const rise = points[before].y - apex.y;
    const fall = points[after].y - apex.y;
    if (Math.min(rise, fall) < height * 0.15) continue;
    let risePath = 0;
    let fallPath = 0;
    for (let j = before + 1; j <= after; j++) {
      const dy = Math.abs(points[j].y - points[j - 1].y);
      if (j <= i) risePath += dy;
      else fallPath += dy;
    }
    const coherence = Math.min(rise / risePath, fall / fallPath);
    if (coherence < 0.65) continue;
    const strength = Math.min(rise, fall) / height;
    candidates.push({
      point: apex,
      confidence: Math.min(1, strength / 0.3) * coherence * mean(window.map((point) => point.confidence)),
      strength,
      reason: `Suggested jump apex: the subject's center rises ${Math.round(rise / height * 100)}% and falls ${Math.round(fall / height * 100)}% of its height. Based on tracked movement.`,
    });
  }
  return candidates;
}

/** Displacement per consecutive frame, normalized by subject diagonal and time. */
function motionCandidates(points: readonly Point[], fps: number, radius: number): Candidate[] {
  const speeds = points.slice(1).map((point, index) => distance(points[index], point) * fps);
  const candidates: Candidate[] = [];
  const support = Math.max(2, Math.ceil(fps * 0.12));
  for (let i = support; i < speeds.length - support; i++) {
    const speed = median(speeds.slice(i - radius, i + radius + 1));
    if (speed < 0.5) continue;
    const window = speeds.slice(i - support, i + support + 1);
    const persistence = Math.min(1, median(window) / speed);
    if (persistence < 0.6) continue;
    const evidence = points.slice(i - support, i + support + 2);
    const displacement = distance(evidence[0], evidence.at(-1)!);
    const path = window.reduce((sum, value) => sum + value / fps, 0);
    const coherence = Math.min(1, displacement / path);
    // Repeated box jitter can have high frame-to-frame speed but no travel.
    if (displacement < 0.1 || coherence < 0.5) continue;
    candidates.push({
      point: points[i + 1],
      confidence: Math.min(1, speed) * persistence * coherence * mean(evidence.map((point) => point.confidence)),
      strength: speed,
      reason: `Suggested peak motion: sustained displacement of ${(speed / fps * 100).toFixed(1)}% of the subject's diagonal per frame. Based on tracked movement.`,
    });
  }
  return candidates;
}

/**
 * Returns only suggestions with enough evidence; null means choose manually.
 * A single selected subject is expected. Frame indices (not model timestamps)
 * supply the normalized-video clock. No interpolation or new AI request.
 */
export function suggestTemporalEvent(track: readonly TrackPoint[], event: TriggerEvent, media: Media): TemporalSuggestion | null {
  if (!Number.isFinite(media.fps) || media.fps <= 0 || !Number.isInteger(media.frameCount) || media.frameCount <= 0) return null;
  const radius = Math.max(1, Math.round(media.fps * 0.04));
  const candidates = segmentsOf(track, media).flatMap((segment) => {
    if (segment.length < Math.max(7, Math.ceil(media.fps * 0.35))) return [];
    const points = smooth(segment, radius);
    return event === "jump_apex" ? jumpCandidates(points, media.fps) : motionCandidates(points, media.fps, radius);
  }).filter((candidate) => candidate.confidence >= MIN_EVENT_CONFIDENCE);
  if (!candidates.length) return null;

  // Use the middle of the highest supported apex / fastest period, so ties do not
  // pick the edge of a plateau (or frame 1 of constant lateral movement).
  const rank = (candidate: Candidate) => event === "jump_apex" ? -candidate.point.y : candidate.strength;
  const strongest = Math.max(...candidates.map(rank));
  const best = candidates.filter((candidate) => rank(candidate) >= strongest - 1e-9);
  const period = [best[0]];
  for (let i = 1; i < best.length && best[i].point.frameIndex === period.at(-1)!.point.frameIndex + 1; i++) period.push(best[i]);
  const chosen = period[Math.floor((period.length - 1) / 2)];
  return {
    event,
    frameIndex: chosen.point.frameIndex,
    timestampMs: Math.floor(chosen.point.frameIndex * 1000 / media.fps),
    confidence: Math.min(1, chosen.confidence),
    reason: chosen.reason,
  };
}
