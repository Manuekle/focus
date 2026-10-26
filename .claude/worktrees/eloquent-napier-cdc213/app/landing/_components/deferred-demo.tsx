"use client";

import { type CSSProperties, type ReactNode, Suspense, useEffect, useRef, useState } from "react";

/** Keep the marketing copy server-rendered, but only mount expensive demos
 * near the viewport. Once mounted, preserve their state across scrolling. */
export function DeferredDemo({
  children,
  className,
  fallback,
  rootMargin = "200px 0px",
  style,
  threshold = 0,
}: {
  readonly children?: ReactNode;
  readonly className: string;
  readonly fallback?: ReactNode;
  readonly rootMargin?: string;
  readonly style?: CSSProperties;
  readonly threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= threshold)) return;
      setReady(true);
      observer.disconnect();
    }, { rootMargin, threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return (
    <div ref={ref} className={className} data-deferred-demo={ready ? "ready" : "pending"} style={style}>
      {ready ? <Suspense fallback={fallback}>{children}</Suspense> : fallback}
    </div>
  );
}
