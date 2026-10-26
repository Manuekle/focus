"use client";
// beui.dev/components/motion/scroll-animation

import type Lenis from "lenis";
import { type MotionValue, useMotionValue } from "motion/react";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import {
  createContext,
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const LenisScroll = lazy(() => import("./lenis-scroll").then((module) => ({ default: module.LenisScroll })));

export type ScrollTarget = number | string | HTMLElement;

export type ScrollToOptions = {
  offset?: number;
  immediate?: boolean;
  duration?: number;
};

export type SmoothScrollApi = {
  /** Underlying Lenis instance, or null on the reduced-motion / native path. */
  lenis: Lenis | null;
  /** Current scroll offset in px. */
  scrollY: MotionValue<number>;
  /** Scroll position as 0..1 of the scrollable height. */
  progress: MotionValue<number>;
  /** Signed scroll velocity (px/frame); drives velocity-based effects. */
  velocity: MotionValue<number>;
  /** Programmatic smooth scroll. Respects reduced motion (jumps instantly). */
  scrollTo: (target: ScrollTarget, options?: ScrollToOptions) => void;
};

const SmoothScrollContext = createContext<SmoothScrollApi | null>(null);

export interface SmoothScrollProps {
  children: ReactNode;
  /** Drive the page (window) when true, or a contained scroll area when false. */
  root?: boolean;
  /** Keep scrolling on the browser compositor, without wheel interpolation. */
  native?: boolean;
  /** Smoothing factor; lower is smoother and heavier. */
  lerp?: number;
  /** Wheel / programmatic ease duration in seconds. */
  duration?: number;
  orientation?: "vertical" | "horizontal";
  /** Wheel scroll speed multiplier. */
  wheelMultiplier?: number;
  /** Smooth touch scrolling. Off by default — native momentum is good on mobile. */
  touch?: boolean;
  className?: string;
}

type ScrollSource = Window | HTMLElement;

function readMetrics(target: ScrollSource) {
  if (target instanceof Window) {
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    return { y: window.scrollY, max };
  }
  return {
    y: target.scrollTop,
    max: Math.max(0, target.scrollHeight - target.clientHeight),
  };
}

function resolveTop(
  target: ScrollTarget,
  source: ScrollSource,
  offset = 0,
): number {
  if (typeof target === "number") return target + offset;
  if (source instanceof Window) {
    const el =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return window.scrollY;
    return el.getBoundingClientRect().top + window.scrollY + offset;
  }
  const el =
    typeof target === "string" ? source.querySelector(target) : target;
  if (!(el instanceof HTMLElement)) return source.scrollTop;
  return el.offsetTop + offset;
}

/** Native scroll listener for the reduced-motion path and the no-provider fallback. */
function useNativeScrollSync(
  enabled: boolean,
  getTarget: () => ScrollSource | null,
  scrollY: MotionValue<number>,
  progress: MotionValue<number>,
  velocity: MotionValue<number>,
) {
  useEffect(() => {
    if (!enabled) return;
    const target = getTarget();
    if (!target) return;
    let { y: lastY, max } = readMetrics(target);
    let lastT = performance.now();
    // The scrollable height changes on resize and when content grows, not on
    // scroll. Reading `scrollHeight` inside the scroll handler forced a
    // synchronous layout on every scroll event, before the page's own
    // animation frames had run, so any frame that had touched the DOM paid
    // for layout twice. Kept current by a ResizeObserver instead.
    const measure = () => {
      max = readMetrics(target).max;
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    // Asks for an element rather than for a Window: under jsdom the global
    // window is not an instance of `Window`, and it has no `children` to walk.
    if (target instanceof HTMLElement) {
      resize?.observe(target);
      for (const child of target.children) resize?.observe(child);
    } else resize?.observe(document.body);
    // The viewport's own height changes `max` without resizing the content.
    if (target instanceof Window) window.addEventListener("resize", measure, { passive: true });
    const onScroll = () => {
      const y = target instanceof Window ? window.scrollY : target.scrollTop;
      const now = performance.now();
      const dt = now - lastT || 16;
      scrollY.set(y);
      progress.set(max > 0 ? Math.min(1, y / max) : 0);
      velocity.set(((y - lastY) / dt) * 16);
      lastY = y;
      lastT = now;
    };
    onScroll();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resize?.disconnect();
      if (target instanceof Window) window.removeEventListener("resize", measure);
      target.removeEventListener("scroll", onScroll);
    };
  }, [enabled, getTarget, scrollY, progress, velocity]);
}

export function SmoothScroll({
  children,
  root = true,
  native = false,
  lerp = 0.1,
  duration = 1.2,
  orientation = "vertical",
  wheelMultiplier = 1,
  touch = false,
  className,
}: SmoothScrollProps) {
  const reduce = useReducedMotion();
  const useNative = native || reduce;
  const scrollY = useMotionValue(0);
  const progress = useMotionValue(0);
  const velocity = useMotionValue(0);
  const lenisRef = useRef<Lenis | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const nativeSource = useCallback(
    (): ScrollSource | null => (root ? window : containerRef.current),
    [root],
  );

  const scrollTo = useCallback(
    (target: ScrollTarget, options?: ScrollToOptions) => {
      const lenis = lenisRef.current;
      if (lenis && !useNative) {
        lenis.scrollTo(target, {
          offset: options?.offset,
          duration: options?.duration,
          immediate: options?.immediate,
        });
        return;
      }
      const source = nativeSource();
      const behavior = reduce || options?.immediate ? "auto" : "smooth";
      const top = resolveTop(target, source ?? window, options?.offset);
      (source ?? window).scrollTo({ top, behavior });
    },
    [reduce, useNative, nativeSource],
  );

  // Native scrolling only publishes metrics when the browser actually scrolls.
  // The optional Lenis implementation loads only when interpolation is wanted.
  useNativeScrollSync(useNative, nativeSource, scrollY, progress, velocity);

  /**
   * The instance is state, not `lenisRef.current` read inside the memo.
   *
   * It was the ref, and the consequence was that `api.lenis` was `null` for
   * every consumer, always: the memo runs on the first render, when the ref is
   * still empty, and `lenisRef` filling in later is not something a memo can
   * see. The type says "Lenis instance, or null on the reduced-motion path",
   * and there was no path on which it was anything but null — so the marketing
   * header's `lenis.stop()` was a no-op and its mobile menu could not lock the
   * page.
   *
   * The ref stays: `scrollTo` reads it during a callback, where the current
   * value is what is wanted and a re-render is not.
   */
  const [lenis, setLenis] = useState<Lenis | null>(null);

  const api = useMemo<SmoothScrollApi>(
    () => ({ lenis, scrollY, progress, velocity, scrollTo }),
    [lenis, scrollY, progress, velocity, scrollTo],
  );

  if (useNative) {
    return (
      <SmoothScrollContext.Provider value={api}>
        <div ref={containerRef} className={className}>
          {children}
        </div>
      </SmoothScrollContext.Provider>
    );
  }

  return (
    <SmoothScrollContext.Provider value={api}>
      <Suspense fallback={<div ref={containerRef} className={className}>{children}</div>}>
        <LenisScroll
          root={root}
          className={className}
          lerp={lerp}
          duration={duration}
          orientation={orientation}
          wheelMultiplier={wheelMultiplier}
          touch={touch}
          scrollY={scrollY}
          progress={progress}
          velocity={velocity}
          lenisRef={lenisRef}
          onInstance={setLenis}
        >
          {children}
        </LenisScroll>
      </Suspense>
    </SmoothScrollContext.Provider>
  );
}

/**
 * Read the page's smooth-scroll state. Inside <SmoothScroll> it returns the
 * shared motion values; outside it falls back to a native window scroll
 * listener so scroll-driven components still work without the provider.
 */
export function useSmoothScroll(): SmoothScrollApi {
  const ctx = useContext(SmoothScrollContext);
  const scrollY = useMotionValue(0);
  const progress = useMotionValue(0);
  const velocity = useMotionValue(0);

  const windowSource = useCallback((): ScrollSource => window, []);
  useNativeScrollSync(ctx === null, windowSource, scrollY, progress, velocity);

  const scrollTo = useCallback((target: ScrollTarget, options?: ScrollToOptions) => {
    window.scrollTo({
      top: resolveTop(target, window, options?.offset),
      behavior: options?.immediate ? "auto" : "smooth",
    });
  }, []);

  const fallback = useMemo<SmoothScrollApi>(
    () => ({ lenis: null, scrollY, progress, velocity, scrollTo }),
    [scrollY, progress, velocity, scrollTo],
  );

  return ctx ?? fallback;
}
