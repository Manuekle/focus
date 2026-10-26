"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "../../lib/utils";

export interface NotificationBadgeProps {
  /** Count to display. When 0 or undefined, the badge hides. */
  count?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * transitions.dev "Notification badge" (.t-badge).
 *
 * A pill that pops in from the bottom-right corner of its trigger
 * with a slide + scale + blur transition. The trigger must be
 * position: relative so the badge can anchor to it.
 *
 * Requires the `.t-badge*` CSS from globals.css.
 */
export function NotificationBadge({
  count,
  className,
  style,
}: NotificationBadgeProps) {
  const [mounted, setMounted] = useState(false);

  // Snap the badge to its closed state on first paint (no animation),
  // then enable the transition on subsequent count changes.
  useEffect(() => {
    setMounted(true);
  }, []);

  const open = mounted && (count ?? 0) > 0;

  return (
    <span
      className={cn("t-badge", className)}
      data-open={open}
      style={style}
      aria-hidden="true"
    >
      <span className="t-badge-dot">{count}</span>
    </span>
  );
}
