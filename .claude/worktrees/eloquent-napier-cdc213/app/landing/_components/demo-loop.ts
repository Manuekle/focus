"use client";

import { useEffect, useState } from "react";

/**
 * The script half of the demo kit, on its own so a screen that plays without
 * a pointer — the hero's conversation — does not pull GSAP into the landing's
 * first bundle with it. `demo-cursor.tsx` re-exports both names.
 */

// ── The script ──────────────────────────────────────────────────────

export type DemoStep<TPhase extends string> = {
  readonly phase: TPhase;
  /** How long this phase holds, in ms. */
  readonly ms: number;
};

/**
 * Walks a script on a timer and starts over at the end.
 *
 * `cycle` counts laps. Anything that has to be rebuilt per lap — a typed
 * string, a stream — keys off it rather than trying to detect the wrap.
 *
 * Held at the first step while `live` is false, so a flow that is off screen
 * is not quietly running a timer and a re-render every 700ms.
 */
export function useDemoLoop<TPhase extends string>(
  script: readonly DemoStep<TPhase>[],
  live: boolean,
): { readonly phase: TPhase; readonly step: number; readonly cycle: number } {
  const [state, setState] = useState({ step: 0, cycle: 0 });

  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => {
      setState((prev) => {
        const next = prev.step + 1;
        return next >= script.length
          ? { step: 0, cycle: prev.cycle + 1 }
          : { step: next, cycle: prev.cycle };
      });
    }, script[state.step]?.ms ?? 1000);
    return () => window.clearTimeout(timer);
  }, [live, script, state.step]);

  return {
    phase: script[state.step]?.phase ?? script[0].phase,
    step: state.step,
    cycle: state.cycle,
  };
}
