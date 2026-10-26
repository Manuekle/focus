"use client";

import { ThinkingOrb, type OrbSize, type OrbState } from "thinking-orbs";
import { cn } from "../../lib/utils";

export type { OrbState, OrbSize };

export interface OrbProps {
  /** Which verb the agent is doing. */
  readonly state: OrbState;
  /** 20 sits inline with text; 64 is for a screen with nothing else on it. */
  readonly size?: OrbSize;
  /**
   * Every call site pairs the orb with a label that already names the state,
   * so by default it is hidden from assistive tech — otherwise a screen reader
   * announces the state twice, once from the orb's own `role="img"` and once
   * from the text beside it.
   */
  readonly decorative?: boolean;
  readonly className?: string;
}

/**
 * The app's one entry point to `thinking-orbs`.
 *
 * Unlike the beam, almost nothing needs wiring here: the package resolves the
 * theme off the `dark` class the app already writes on `<html>`, renders a
 * static frame under `prefers-reduced-motion`, and pauses itself offscreen and
 * on a hidden tab. This exists for the inline default size and the a11y
 * default, so neither gets re-decided at every call site.
 */
export function Orb({ state, size = 20, decorative = true, className }: OrbProps) {
  return (
    <ThinkingOrb
      state={state}
      size={size}
      aria-hidden={decorative || undefined}
      className={cn("shrink-0", className)}
    />
  );
}
