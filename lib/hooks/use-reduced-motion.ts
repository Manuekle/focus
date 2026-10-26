"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

let media: MediaQueryList | null = null;

function query(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  media ??= window.matchMedia(QUERY);
  return media;
}

/**
 * The preference right now. For code that reads it at the moment it acts — a
 * click handler, a one-shot animation, a canvas frame — rather than in render.
 */
export function prefersReducedMotion(): boolean {
  return query()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  if (!list) return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * Whether the user asked for reduced motion, kept current for the whole
 * session.
 *
 * Use this, not the hook of the same name from `motion/react`: Motion's reads
 * the preference once into its first render's state and never again, so
 * switching the OS setting with the app open leaves every mounted component
 * animating as before (MOTION-05 in docs/motion-audit-2026-10-07.md). This one
 * subscribes, so the change reaches the next render of everything that asked —
 * a panel already open closes with the reduced variant.
 *
 * The server cannot know the preference, so the server render and the
 * hydration render both answer `false` and the real value follows in the
 * commit right after. Answering the live value during hydration (as Motion's
 * hook did) made any component whose text or attributes depend on it — a
 * score that counts up, say — differ from the server HTML, and React threw the
 * whole tree away to render it again on the client. The motion that first
 * pass could start is covered by `MotionProvider`, which tells Motion itself to
 * skip transform and layout animation for these users.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, serverSnapshot);
}

function serverSnapshot(): boolean {
  return false;
}
