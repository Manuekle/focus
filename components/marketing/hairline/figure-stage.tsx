"use client";

import { useEffect, useRef, useState } from "react";
import HL from "./kernel.js";
import styles from "./hairline.module.css";

/**
 * Where a callout's name goes: the margin end of a leader the figure drew, in
 * viewBox units. A side name sits level with its leader, beside it; a top or
 * bottom name sits centred over or under it.
 */
export type FigureLabel = {
  readonly id: string;
  readonly side: "left" | "right" | "top" | "bottom";
  readonly x: number;
  readonly y: number;
};

type Read = { textContent: string | null };
type Handle = { set(value: number): void; destroy(): void; labels?: readonly FigureLabel[] };

/** A figure module's default export, as `hairline({ … })` declares it. */
export type HairlineFigure = {
  readonly name: string;
  readonly range: readonly number[];
  readonly mount: (host: { stage: HTMLElement; svg: SVGSVGElement; read: Read }, value: number) => Handle;
};

/**
 * The part of the 400 × 320 viewBox a page shows: a band from top to bottom,
 * and, for a figure with no callouts to make room for, from left to right too.
 * The figures leave the rest empty.
 */
export type FigureFrame = readonly [top: number, bottom: number, left?: number, right?: number];

/** Intensity to the figure's own number: two straight lines that meet at 0.5, as on the bench. */
function valueAt(range: readonly number[], intensity: number): number {
  const [lo, mid, hi] = range;
  return intensity <= 0.5 ? lo + (intensity / 0.5) * (mid - lo) : mid + ((intensity - 0.5) / 0.5) * (hi - mid);
}

/** Where a name is printed and how it is anchored, from the end of its leader. */
function place(label: FigureLabel) {
  switch (label.side) {
    case "left":
      return { anchor: "end", x: label.x - 5, y: label.y + 3 } as const;
    case "right":
      return { anchor: "start", x: label.x + 5, y: label.y + 3 } as const;
    case "top":
      return { anchor: "middle", x: label.x, y: label.y - 5 } as const;
    case "bottom":
      return { anchor: "middle", x: label.x, y: label.y + 11 } as const;
  }
}

/**
 * The page's side of a Hairline figure: what the skill's bench does, minus the
 * bench. It makes the svg, hands it to the figure with a read-out, and prints
 * the callouts' names where the figure's leaders end — the words stay out of
 * the drawing, the way the figures' rule 10 wants them.
 *
 * The read-out is not shown as text. Its first word names a callout (or the
 * callouts whose ids start with it and a dash), and that callout takes the
 * bright ink while the pointer is on its part: the drawing and its label
 * answer together. A page that wants the same word for something of its own —
 * a list under the drawing — gets it through `onActive`.
 *
 * `frame` crops the 400 × 320 stage to the part the figure draws in. The stage
 * itself keeps its proportions, because the kernel reads the pointer against
 * its whole rectangle; the crop is a window over it, so a figure in a short
 * band is not drawn smaller to fill a tall one, and a figure cropped at the
 * sides is drawn larger for the width it is given.
 *
 * The drawing arrives once, out of a blur, the first time it is seen. It is the
 * only blur on the page and it is gone when it lands: the filter is dropped
 * with the transition, so nothing is left composited.
 */
export function FigureStage({
  figure,
  frame = [0, 320],
  intensity = 0.5,
  names = {},
  onActive,
  tone = "blue",
}: {
  readonly figure: HairlineFigure;
  readonly frame?: FigureFrame;
  readonly intensity?: number;
  /** A callout's printed name, by the id the figure gives its leader. */
  readonly names?: Readonly<Record<string, string>>;
  readonly onActive?: (id: string | null) => void;
  readonly tone?: "blue" | "neutral";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(onActive);
  const [labels, setLabels] = useState<readonly FigureLabel[]>([]);
  const [active, setActive] = useState<string | null>(null);
  // Without an observer to wait for, it is simply there.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    activeRef.current = onActive;
  }, [onActive]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    HL.inject(document);
    stage.setAttribute("data-hairline", figure.name);
    const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage) as SVGSVGElement;

    let text: string | null = null;
    const read: Read = {
      get textContent() {
        return text;
      },
      set textContent(value) {
        text = value == null ? "" : String(value);
        const id = text.split(" ")[0];
        const next = id === "rest" || id === "" ? null : id;
        setActive(next);
        activeRef.current?.(next);
      },
    };

    const handle = figure.mount({ stage, svg, read }, valueAt(figure.range, intensity));
    setLabels(handle.labels ?? []);
    return () => {
      handle.destroy();
      svg.remove();
      stage.removeAttribute("data-hairline");
    };
    // The figure mounts once; intensity is fixed for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figure]);

  // Arrive the first time a third of it is on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.3 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const [top, bottom, left = 0, right = 400] = frame;
  const wide = right - left;
  return (
    <div
      aria-hidden="true"
      className={styles.figure}
      data-landed={landed || undefined}
      data-shown={shown || undefined}
      data-tone={tone}
      ref={rootRef}
      // Cropped at the sides, the frame clips them too; otherwise a long
      // callout name may run into the padding.
      style={{ aspectRatio: `${wide} / ${bottom - top}`, clipPath: wide < 400 ? "inset(0)" : undefined }}
    >
      <div
        className={styles.window}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === "filter") setLanded(true);
        }}
        style={{
          marginLeft: `${(-left / wide) * 100}%`,
          marginTop: `${(-top / wide) * 100}%`,
          width: `${(400 / wide) * 100}%`,
        }}
      >
        <div className={styles.stage} ref={stageRef} />
        <svg className={styles.labels} viewBox="0 0 400 320">
          {labels.map((label) => {
            const name = names[label.id];
            if (!name) return null;
            const at = place(label);
            const lit = active !== null && (label.id === active || label.id.startsWith(`${active}-`));
            return (
              <text
                className={styles.name}
                data-active={lit || undefined}
                key={label.id}
                textAnchor={at.anchor}
                x={at.x}
                y={at.y}
              >
                {name}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
