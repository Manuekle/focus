"use client";

import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import type { HairlineFigure } from "../marketing/hairline/figure-stage";
import styles from "./product-figure.module.css";

export type ProductFigureKind = "credits" | "channels" | "archive" | "empty-archive" | "rack";

const figures: Record<ProductFigureKind, () => Promise<HairlineFigure>> = {
  credits: () => import("./credits.js").then((module) => module.default),
  channels: () => import("./channels.js").then((module) => module.default),
  archive: () => import("./archive.js").then((module) => module.default),
  "empty-archive": () => import("./archive.js").then((module) => module.emptyArchive),
  rack: () => import("./rack.js").then((module) => module.default),
};

/** Decorative, pointer-responsive artwork. Text and actions remain in the surrounding UI. */
export function ProductFigure({ kind, className, surface = "card" }: {
  readonly kind: ProductFigureKind;
  readonly className?: string;
  readonly surface?: "card" | "feature";
}) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;

    async function mount() {
      const [{ default: HL }, figure] = await Promise.all([
        import("../marketing/hairline/kernel.js"),
        figures[kind](),
      ]);
      if (disposed || !stage) return;
      HL.inject(document);
      stage.dataset.hairline = figure.name;
      const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage) as SVGSVGElement;
      const handle = figure.mount({ stage, svg, read: { textContent: "rest" } }, figure.range[1]);
      destroy = () => { handle.destroy(); svg.remove(); delete stage.dataset.hairline; };
    }

    // Reserve the frame immediately, and load its engine only when it is near the viewport.
    if (typeof IntersectionObserver === "undefined") {
      void mount();
    } else {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        void mount();
      }, { rootMargin: "120px" });
      observer.observe(stage);
    }
    return () => { disposed = true; observer?.disconnect(); destroy?.(); };
  }, [kind]);

  return <div aria-hidden="true" className={cn(styles.figure, className)} data-surface={surface} ref={stageRef} />;
}
