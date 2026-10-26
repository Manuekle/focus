"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A horizontal scroll container that applies the same fade-edge effect used by
 * the pipeline kanban board. There is no slider or arrow row: the faded edge
 * is the cue that more cards sit past it, and the row scrolls by swipe,
 * trackpad, shift + wheel or by tabbing into a card.
 */
export function CardCarousel({
  children,
  className,
  label,
  stats = false,
}: {
  readonly children: ReactNode;
  /** Extra classes on the outer wrapper. */
  readonly className?: string;
  /** Accessible name for the scrolling region. */
  readonly label?: string;
  /** A row of KPI tiles: swipes on a phone, lays out as a grid once the
   *  column fits them (`.kpi-row` in globals.css). */
  readonly stats?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const measureFade = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    // Only fade edges that actually have hidden content past them.
    scroller.style.setProperty("--x-fade-start", scroller.scrollLeft > 4 ? "40px" : "0px");
    scroller.style.setProperty("--x-fade-end", scroller.scrollLeft < max - 4 ? "40px" : "0px");
  }, []);

  useEffect(() => {
    measureFade();
    const scroller = scrollerRef.current;
    scroller?.addEventListener("scroll", measureFade, { passive: true });
    window.addEventListener("resize", measureFade);
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measureFade()) : null;
    if (scroller) ro?.observe(scroller);
    // Layout settles after first paint (fonts, container queries).
    const settled = setTimeout(measureFade, 300);
    return () => {
      scroller?.removeEventListener("scroll", measureFade);
      window.removeEventListener("resize", measureFade);
      ro?.disconnect();
      clearTimeout(settled);
    };
  }, [measureFade, children]);

  return (
    <div className={cn("relative min-w-0", stats && "kpi-row-frame", className)}>
      {/* Horizontal scroller with fade edges. `overflow-x-auto` alone computes
          overflow-y to `auto`, so a card's shadow or a stray pixel of height
          made the row scroll vertically, and `overscroll-contain` then kept
          that wheel from reaching the page. Pin Y and contain only X, same
          as the pipeline board. */}
      <div
        ref={scrollerRef}
        role="region"
        aria-label={label}
        className={cn(
          "x-fade overscroll-x-contain overflow-x-auto overflow-y-clip scrollbar-hide",
          stats && "kpi-row",
        )}
      >
        {children}
      </div>
    </div>
  );
}
