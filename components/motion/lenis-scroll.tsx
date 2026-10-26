"use client";

import type Lenis from "lenis";
import { ReactLenis, useLenis } from "lenis/react";
import type { MotionValue } from "motion/react";
import { useEffect } from "react";
import type { SmoothScrollProps } from "./smooth-scroll";

// Lenis needs an easing function rather than the motion system's bezier tuple.
const EASE_SCROLL = (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t));

type BridgeProps = {
  scrollY: MotionValue<number>;
  progress: MotionValue<number>;
  velocity: MotionValue<number>;
  lenisRef: { current: Lenis | null };
  onInstance: (instance: Lenis | null) => void;
};

/** Pushes Lenis' live scroll state into the shared motion values, and the
 *  instance itself up to the provider. */
function LenisBridge({
  scrollY,
  progress,
  velocity,
  lenisRef,
  onInstance,
}: {
  scrollY: MotionValue<number>;
  progress: MotionValue<number>;
  velocity: MotionValue<number>;
  lenisRef: { current: Lenis | null };
  onInstance: (instance: Lenis | null) => void;
}) {
  const lenis = useLenis((instance) => {
    scrollY.set(instance.scroll);
    progress.set(instance.progress);
    velocity.set(instance.velocity);
  });
  useEffect(() => {
    lenisRef.current = lenis ?? null;
    onInstance(lenis ?? null);
    return () => {
      lenisRef.current = null;
      onInstance(null);
    };
  }, [lenis, lenisRef, onInstance]);
  return null;
}

export function LenisScroll({
  children, root, className, lerp, duration, orientation, wheelMultiplier, touch,
  ...bridge
}: SmoothScrollProps & BridgeProps) {
  return (
    <ReactLenis
      root={root}
      className={className}
      options={{ lerp, duration, orientation, wheelMultiplier, smoothWheel: true,
        syncTouch: touch, easing: EASE_SCROLL, anchors: true }}
    >
      <LenisBridge {...bridge} />
      {children}
    </ReactLenis>
  );
}
