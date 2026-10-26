"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

const loadFeatures = () => import("./features").then((module) => module.default);

/**
 * `reducedMotion="user"` makes Motion skip transform and layout animation for
 * anyone who asked for reduced motion, decided per element when it mounts.
 * Components still pick their own reduced variants from `useReducedMotion`
 * (lib/hooks/use-reduced-motion.ts); this is the floor under them — above all
 * for the hydration render, where that hook has to answer `false` to match
 * the server HTML.
 */
export function MotionProvider({ children }: { readonly children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures}>{children}</LazyMotion>
    </MotionConfig>
  );
}
