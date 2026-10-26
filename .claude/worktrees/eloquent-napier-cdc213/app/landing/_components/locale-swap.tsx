"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { I18nLocale, useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

function textSwapDur(): number {
  return (
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur"),
    ) || 260
  );
}

/**
 * Wraps the landing page body so toggling the language crossfades the copy
 * instead of snapping it. The wrapper's own `height` tweens across the swap
 * too, so sections below never jump the instant the other locale's copy
 * runs a different length — the thing that made the raw swap feel broken.
 *
 * Renders the outgoing locale until the exit animation finishes, then pins
 * the subtree to the new one with `I18nLocale` while the real preference
 * (read by the footer's `LanguageToggle`) has already moved on. The first
 * locale resolution — the default-locale SSR markup correcting to whatever
 * the visitor's browser or `localStorage` says once the client mounts — is
 * intentionally not animated; only a toggle the visitor actually triggers is.
 */
export function LandingLocaleSwap({ children }: { readonly children: ReactNode }) {
  const { locale } = useI18n();
  const [displayLocale, setDisplayLocale] = useState(locale);
  const [phase, setPhase] = useState<"idle" | "exit" | "enter-start">("idle");
  const wrapRef = useRef<HTMLDivElement>(null);
  const skipNextAnimation = useRef(true);

  useEffect(() => {
    if (locale === displayLocale) return;

    if (skipNextAnimation.current) {
      skipNextAnimation.current = false;
      setDisplayLocale(locale);
      return;
    }

    const wrap = wrapRef.current;
    if (!wrap) {
      setDisplayLocale(locale);
      return;
    }

    const dur = textSwapDur();
    wrap.style.height = `${wrap.getBoundingClientRect().height}px`;
    setPhase("exit");

    const exitTimer = setTimeout(() => {
      setDisplayLocale(locale);
      setPhase("enter-start");

      requestAnimationFrame(() => {
        const next = wrapRef.current;
        if (!next) return;
        next.style.height = `${next.scrollHeight}px`;
        void next.offsetHeight; // reflow so height + enter both transition from here
        setPhase("idle");
      });
    }, dur);

    return () => clearTimeout(exitTimer);
  }, [locale, displayLocale]);

  // Once the enter transition lands, release the pinned height back to
  // `auto` so later reflows (viewport resize, web font swap) aren't stuck
  // tracking a stale pixel value.
  useEffect(() => {
    if (phase !== "idle") return;
    const wrap = wrapRef.current;
    if (!wrap?.style.height) return;
    const release = setTimeout(() => {
      if (wrapRef.current) wrapRef.current.style.height = "";
    }, textSwapDur());
    return () => clearTimeout(release);
  }, [phase]);

  return (
    <div ref={wrapRef} className="lp-locale-swap">
      <div
        className={cn(
          "lp-locale-swap-inner",
          phase === "exit" && "is-exit",
          phase === "enter-start" && "is-enter-start",
        )}
      >
        <I18nLocale locale={displayLocale}>{children}</I18nLocale>
      </div>
    </div>
  );
}
