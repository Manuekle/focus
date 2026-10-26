"use client";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "../icons/icon";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/**
 * Transitions.dev — Success check.
 *
 * Wrap icon in .t-success-check. Wrapper drives fade + rotate + blur + Y-bob;
 * if icon is SVG <path>, it gets stroke-draw animation. Bring own size/colors
 * via className.
 *
 * Cold load is data-state="out" (opacity 0; no animation). Show sets
 * data-state="in". Snippet covers appear only — hide = unmount.
 */
export function SuccessCheck({
  active,
  className,
  children,
}: {
  readonly active: boolean;
  readonly className?: string;
  readonly children?: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(active);

  useEffect(() => {
    if (active) setShown(true);
  }, [active]);

  // Calibrate stroke-dash to real path length once mounted.
  // Snippet hardcodes 20 as placeholder; getTotalLength() avoids
  // pre-reveal (too short) or over-draw (too long).
  useEffect(() => {
    if (!shown || !wrapperRef.current) return;
    for (const path of wrapperRef.current.querySelectorAll<SVGPathElement>("svg path")) {
      // Not `instanceof SVGPathElement`: environments without SVG layout
      // (jsdom) have no such global, and the check then threw on mount.
      if (typeof path.getTotalLength !== "function") continue;
      const len = Math.ceil(path.getTotalLength()) + 1;
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    }
  }, [shown]);

  // Replay-on-retrigger: reset to "out", force reflow, flip to "in"
  // so keyframes restart from offset 0.
  useEffect(() => {
    if (!active || !wrapperRef.current) return;
    const el = wrapperRef.current;
    el.setAttribute("data-state", "out");
    void el.offsetWidth; // force reflow so keyframes restart
    el.setAttribute("data-state", "in");
  }, [active, shown]);

  if (!shown) return null;

  return (
    <span ref={wrapperRef} className={cn("t-success-check", className)} data-state="out" aria-hidden="true">
      {children ?? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size="1em" strokeWidth={2} className="text-green-500" />
      )}
    </span>
  );
}
