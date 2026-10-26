"use client";

import { cn } from "../../lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface SlidingTab {
  readonly id: string;
  readonly label: ReactNode;
  /** Extra `data-*` attributes for this tab's button, such as a per-tab `data-cuelume-theme`. */
  readonly data?: Readonly<Record<`data-${string}`, string>>;
}

export interface SlidingTabsProps {
  tabs: readonly SlidingTab[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
  /** Optional content rendered to the right of the tabs, inside the bar. */
  trailing?: ReactNode;
}

/**
 * transitions.dev "Tabs sliding" (.t-tabs).
 *
 * A segmented tab bar with a pill that slides between tabs using
 * measured offsetLeft / offsetWidth. On first paint and resize the
 * pill snaps without a transition; on tab click it animates.
 *
 * Requires the `.t-tabs*` CSS from globals.css.
 *
 * Deliberately NOT `role="tablist"` / `role="tab"`. Those roles promise a
 * composite widget — one tab stop, arrow keys between tabs, and an
 * `aria-controls` panel — and this bar has none of that. It is also used for
 * things that are not tabs at all (pagination, a monthly/yearly price
 * toggle), where the roles would be wrong even with the keyboard handling.
 * Plain buttons carrying `aria-pressed` describe what this actually is: a
 * group of toggles, each its own tab stop, one of them on.
 */
export function SlidingTabs({
  tabs,
  value,
  onValueChange,
  className,
  trailing,
}: SlidingTabsProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const valueRef = useRef(value);
  const hasSnappedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const activeTab = tabs.some((tab) => tab.id === value);

  // Keep valueRef in sync so positionPill can read the latest value
  // without being recreated on every change — this prevents the
  // snap effect from firing on value changes and clobbering the
  // animate effect.
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  /** Position the pill at the active tab. When `animate` is false,
   *  the transition is suspended so the pill snaps instantly. */
  const positionPill = useCallback((animate: boolean) => {
    const pill = pillRef.current;
    const tab = tabRefs.current.get(valueRef.current);
    if (!pill) return;

    if (!tab) {
      pill.style.transition = "none";
      pill.style.width = "0px";
      pill.style.transform = "translateX(0px)";
      void pill.offsetWidth;
      pill.style.transition = "";
      return;
    }

    if (!animate) {
      pill.style.transition = "none";
    }
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;

    if (!animate) {
      // Force reflow then restore the CSS transition
      void pill.offsetWidth;
      pill.style.transition = "";
    }
  }, []);

  // Snap on first paint (no animation) — runs once after mount
  useEffect(() => {
    positionPill(false);
    hasSnappedRef.current = true;
    setReady(true);
  }, [positionPill]);

  // Animate on value change (after first paint)
  useEffect(() => {
    if (!hasSnappedRef.current) return;
    positionPill(true);
  }, [value, positionPill]);

  // A tab's label can change without its value changing — for example,
  // `Log` becoming `Log (61)`. Observe the tab buttons so the active pill
  // grows with its content instead of leaving a badge outside the selection.
  useEffect(() => {
    if (!hasSnappedRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionPill(true));
    for (const tab of tabRefs.current.values()) observer.observe(tab);
    return () => observer.disconnect();
  }, [tabs, positionPill]);

  // Re-snap on resize (no animation)
  useEffect(() => {
    if (!hasSnappedRef.current) return;
    const handleResize = () => positionPill(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [positionPill]);

  // On a narrow phone the bar scrolls sideways (`.t-tabs` caps it at its
  // container). Fade only the edges that hide a tab, and keep the active
  // tab in view when it changes.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const updateFade = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      bar.style.setProperty("--x-fade-start", bar.scrollLeft > 4 ? "24px" : "0px");
      bar.style.setProperty("--x-fade-end", bar.scrollLeft < max - 4 ? "24px" : "0px");
    };
    updateFade();
    bar.addEventListener("scroll", updateFade, { passive: true });
    window.addEventListener("resize", updateFade);
    return () => {
      bar.removeEventListener("scroll", updateFade);
      window.removeEventListener("resize", updateFade);
    };
  }, [tabs]);

  useEffect(() => {
    const bar = barRef.current;
    const tab = tabRefs.current.get(value);
    if (!bar || !tab || bar.scrollWidth <= bar.clientWidth) return;
    if (tab.offsetLeft < bar.scrollLeft || tab.offsetLeft + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) {
      bar.scrollTo({ left: tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [value]);

  return (
    <div className={cn("t-tabs x-fade", className)} ref={barRef}>
      <span
        className="t-tabs-pill"
        ref={pillRef}
        style={{ visibility: ready && activeTab ? "visible" : "hidden" } as CSSProperties}
        aria-hidden="true"
      />
      {tabs.map((tab) => (
        <button
          aria-pressed={tab.id === value}
          className="t-tab"
          data-cuelume-select
          {...tab.data}
          key={tab.id}
          onClick={() => onValueChange(tab.id)}
          ref={(el) => {
            if (el) tabRefs.current.set(tab.id, el);
            else tabRefs.current.delete(tab.id);
          }}
          type="button"
        >
          {tab.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}
