"use client";

// The figures for the screens a person sees when something is missing, broken
// or unreachable: Query on a 404, Plug on an error, Rail when offline.
//
// These screens are exactly where a failed chunk is most likely, so the
// figure is never part of the first render: it is imported after paint, and
// the static mark in `fallback` stays if that import or its mount fails. The
// library owns its own rAF loop, pauses off screen and renders a still figure
// under `prefers-reduced-motion`, so mounting it adds no idle animation work.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Figure, HairlineOptions } from "@lucasmarkes/hairline";
import { cn } from "../../lib/utils";
import styles from "./state-figure.module.css";

export type StateFigureKind = "not-found" | "error" | "offline";

type Mount = (el: HTMLElement, options?: HairlineOptions) => Figure;

const figures: Record<StateFigureKind, () => Promise<Mount>> = {
  "not-found": () => import("@lucasmarkes/hairline").then((module) => module.query),
  error: () => import("@lucasmarkes/hairline").then((module) => module.plug),
  offline: () => import("@lucasmarkes/hairline").then((module) => module.rail),
};

export function StateFigure({
  kind,
  className,
  style,
  fallback,
  intensity = 0.5,
}: {
  readonly kind: StateFigureKind;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** The static mark already on the screen. It stays if the figure can't load. */
  readonly fallback?: ReactNode;
  readonly intensity?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let live = true;
    let figure: Figure | undefined;
    let cancel = () => {};

    const mount = () => {
      void figures[kind]()
        .then((create) => {
          if (!live || !hostRef.current) return;
          figure = create(hostRef.current, { intensity });
          hostRef.current.dataset.ready = "";
        })
        // A 404, a 500 and an offline screen can all run without the chunk.
        // The copy and the actions are the point; keep the fallback mark.
        .catch(() => {});
    };

    // Draw after the sentence and the buttons have painted. `requestIdleCallback`
    // keeps a low-end phone from paying for the geometry during first paint.
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(mount, { timeout: 600 });
      cancel = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(mount, 0);
      cancel = () => window.clearTimeout(handle);
    }

    return () => {
      live = false;
      cancel();
      figure?.destroy();
      delete host.dataset.ready;
    };
  }, [kind, intensity]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-state-figure={kind}
      className={cn(styles.frame, className)}
      style={style}
    >
      {fallback ? <div className={styles.fallback}>{fallback}</div> : null}
    </div>
  );
}
