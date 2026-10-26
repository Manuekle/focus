/**
 * The arithmetic of the landing's story loops.
 *
 * A story is authored the way the launch reels are (`~/Dev/remotion`): every
 * element is a pure function of one clock, in milliseconds since the loop
 * began. Nothing here keeps state, so any moment of a story can be drawn on
 * its own — the paused frame, the reduced-motion poster and the frame a lap
 * is on are the same function evaluated at a different `t`.
 *
 * No bounce anywhere. The springs are critically damped and the curves are the
 * app's own (`lib/ease.ts`), so an element arrives and settles; it never
 * overshoots and comes back.
 */

import type { CSSProperties } from "react";

// ── Curves ───────────────────────────────────────────────────────────

type Curve = (x: number) => number;

/** A CSS `cubic-bezier()` as a function: Newton steps, bisection fallback. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 6; i++) {
      const error = sampleX(s) - x;
      const slope = slopeX(s);
      if (Math.abs(error) < 1e-5) return sampleY(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    while (hi - lo > 1e-5) {
      if (sampleX(s) < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

export const ease = {
  /** `--ease-expo-out`: fast arrival, long settle. Most entrances. */
  out: bezier(0.16, 1, 0.3, 1),
  /** `--ease-smooth-out`: surfaces. */
  smooth: bezier(0.22, 1, 0.36, 1),
  /** Travel between two places: camera, cursor, layout. */
  inOut: bezier(0.65, 0, 0.35, 1),
  /** Exits accelerate away. */
  in: bezier(0.55, 0, 1, 0.45),
  linear: (x: number) => x,
} as const;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** 0 → 1 between `at` and `at + dur`, through `curve`. */
export function ramp(t: number, at: number, dur: number, curve: Curve = ease.out): number {
  return curve(clamp01((t - at) / dur));
}

/**
 * A critically damped spring from 0 to 1 that starts at `at` and is within
 * 1% of rest after `dur`. It has no overshoot by construction, which is the
 * whole reason it is used instead of a bezier for things that travel.
 */
export function settle(t: number, at: number, dur = 600): number {
  const x = (t - at) / dur;
  if (x <= 0) return 0;
  if (x >= 1.4) return 1;
  const k = 6.64; // (1 + k) e^-k = 0.01
  return 1 - (1 + k * x) * Math.exp(-k * x);
}

/** 0 → 1 → 0 across [a, b], peaking in the middle, smooth at both ends. */
export function bump(t: number, a: number, b: number): number {
  const x = clamp01((t - a) / (b - a));
  return Math.sin(Math.PI * x) ** 2;
}

// ── Element motion ───────────────────────────────────────────────────

export type Enter = {
  readonly dur?: number;
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly blur?: number;
  readonly curve?: Curve;
};

export type Leave = {
  readonly at: number;
  readonly dur?: number;
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly blur?: number;
};

/**
 * Inline style for something that arrives at `at` and, optionally, leaves.
 * The defaults are the landing's fade-blur: a short rise, a slight scale, and
 * the focus pulling in as it lands. A filter is only written while it is
 * non-zero, so a settled element is not left on its own filter layer.
 */
export function reveal(t: number, at: number, enter: Enter = {}, leave?: Leave): CSSProperties {
  const { dur = 560, x = 0, y = 10, scale = 0.985, blur = 4, curve = ease.out } = enter;
  const p = ramp(t, at, dur, curve);
  const q = leave ? ramp(t, leave.at, leave.dur ?? 380, ease.in) : 0;
  const opacity = p * (1 - q);
  if (opacity <= 0.001) return { opacity: 0, visibility: "hidden" };
  const tx = (1 - p) * x + q * (leave?.x ?? 0);
  const ty = (1 - p) * y + q * (leave?.y ?? -6);
  const s = mix(scale, 1, p) * mix(1, leave?.scale ?? 0.99, q);
  const b = (1 - p) * blur + q * (leave?.blur ?? 4);
  return {
    opacity,
    transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(4)})`,
    filter: b > 0.05 ? `blur(${b.toFixed(2)}px)` : undefined,
  };
}

/** Opacity-only variant for elements inside something already moving. */
export function fade(t: number, at: number, dur = 300, out?: number, outDur = 260): number {
  const p = ramp(t, at, dur, ease.smooth);
  const q = out === undefined ? 0 : ramp(t, out, outDur, ease.in);
  return p * (1 - q);
}

// ── Text ─────────────────────────────────────────────────────────────

/** How many characters of `text` a typist has entered by `t`. */
export function typed(text: string, t: number, at: number, cps = 32): string {
  if (t <= at) return "";
  const count = Math.floor(((t - at) / 1000) * cps);
  return Array.from(text).slice(0, count).join("");
}

/** When typing `text` from `at` at `cps` finishes. */
export const typedUntil = (text: string, at: number, cps = 32) => at + (Array.from(text).length / cps) * 1000;

/** When a word stream started at `at` with `gap` ms per word finishes. */
export const streamedUntil = (text: string, at: number, gap = 42) => at + text.split(" ").length * gap + 220;

// ── Paths ────────────────────────────────────────────────────────────

/** A point travelling a list of stops: holds at each, eases between. */
export function travel(
  t: number,
  stops: readonly { readonly at: number; readonly x: number; readonly y: number; readonly dur?: number }[],
): { x: number; y: number } {
  let x = stops[0].x;
  let y = stops[0].y;
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i];
    const p = settle(t, stop.at, stop.dur ?? 700);
    if (p <= 0) break;
    x = mix(x, stop.x, p);
    y = mix(y, stop.y, p);
  }
  return { x, y };
}

// ── Values ───────────────────────────────────────────────────────────

/**
 * A displayed value that changes at given moments, as the pair a `Roll`
 * animates between: the value before the latest change, the value after it,
 * and when it happened.
 */
export function counter(
  t: number,
  start: string,
  changes: readonly (readonly [at: number, value: string])[],
): { readonly from: string; readonly to: string; readonly at: number } {
  let from = start;
  let to = start;
  let at = -1e9;
  for (const [when, value] of changes) {
    if (t < when) break;
    from = to;
    to = value;
    at = when;
  }
  return { from, to, at };
}
