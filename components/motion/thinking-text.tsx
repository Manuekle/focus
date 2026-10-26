"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useAnimationActive } from "../../lib/hooks/use-animation-active";

/**
 * transitions.dev "Thinking states" (`.t-think`).
 *
 * Cycles a line of copy while something is happening. The shimmer runs on
 * `::before` off `data-text`, so the visible text and the shimmered copy have
 * to stay in sync — both are set from the same value here rather than left to
 * two renders to agree.
 *
 * Swaps use animation frames to stage the incoming text without a forced
 * layout. Timers pause offscreen, in hidden tabs and under reduced motion.
 *
 * The hidden sizer holds the longest state and is what gives the box its
 * width, so the button around it never resizes mid-swap — which is the whole
 * reason to use this rather than swapping a string.
 */
export function ThinkingText({
  className,
  hold = 2000,
  states,
}: {
  readonly className?: string;
  /** Time each state holds, in ms. */
  readonly hold?: number;
  readonly states: readonly string[];
}) {
  const [index, setIndex] = useState(0);
  const textRef = useRef<HTMLSpanElement>(null);
  const live = useAnimationActive(textRef);

  useEffect(() => {
    if (states.length <= 1 || !live) return;
    const el = textRef.current;
    if (!el) return;
    let swap = 0;
    let frame = 0;
    const timer = window.setInterval(() => {
      el.classList.add("is-exit");
      swap = window.setTimeout(() => {
        setIndex((current) => (current + 1) % states.length);
        el.classList.remove("is-exit");
        el.classList.add("is-enter-start");
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => el.classList.remove("is-enter-start"));
        });
      }, 150);
    }, hold);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(swap);
      cancelAnimationFrame(frame);
      el.classList.remove("is-exit", "is-enter-start");
    };
  }, [hold, states.length, live]);

  // The longest state by character count is the one the box has to fit. Cheap
  // to compute and stable, because `states` is a constant at every call site.
  const longest = states.reduce((a, b) => (b.length > a.length ? b : a), "");
  const current = states[index] ?? "";

  return (
    <span className={cn("t-think", className)} role="status">
      <span aria-hidden="true" className="t-think-sizer">
        {longest}
      </span>
      <span className="t-think-text" data-text={current} ref={textRef}>
        {current}
      </span>
    </span>
  );
}
