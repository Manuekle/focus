"use client";
// beui.dev/components/motion/text-animation

import * as motion from "motion/react-m";
import { type Transition, useInView } from "motion/react";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { useRef, type ReactNode } from "react";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

type SplitMode = "word" | "char";

/**
 * Text-level wrappers only, rather than `ElementType`.
 *
 * A prop typed as "any element" has to satisfy every element's props at
 * once, so any dependency that augments the global JSX table (as
 * `@react-three/fiber` did while the voice orb used it) collapses `children`
 * and `className` to `never` here. The narrow list is also closer to the
 * truth: this renders text, and every call site passes h1, h2 or span.
 */
type TextTag =
  | "span"
  | "div"
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "label"
  | "strong"
  | "em";


export interface TextRevealProps {
  text: string | string[];
  as?: TextTag;
  className?: string;
  split?: SplitMode;
  stagger?: number;
  delay?: number;
  blur?: number;
  yOffset?: string | number;
  spring?: { stiffness?: number; damping?: number; mass?: number };
  once?: boolean;
  whileInView?: boolean;
  children?: ReactNode;
  /**
   * A class on every animated unit, not on the wrapper.
   *
   * For anything that has to be applied per glyph-group rather than around the
   * text — `.lp-lumen`, whose milled ramp is a `background-clip: text` and so
   * is painted by the element that declares it and masked by *its own* text.
   * On the wrapper, every unit inside it animates opacity and a blur, which
   * composites each one separately and puts it outside that paint: the words
   * come out with the transparent fill and nothing behind them, and a milled
   * headline is invisible for the length of its own entrance. On the unit the
   * clip and the animation are the same element.
   *
   * Same lesson as `DigitPop`'s `luminous`, and the same fix.
   */
  unitClassName?: string;
}

/**
 * Timing for one unit. Tweens on `transform`, `opacity` and `filter`, never
 * `y`: those three run on the compositor through WAAPI, while an independent
 * `y` with a spring is a JS loop per word writing styles every frame. The old
 * spring (140/26/1.2) also took over a second to settle, so a heading was
 * still drifting into place after the reader had moved on to the paragraph.
 */
const UNIT_DURATION = { opacity: 0.45, transform: 0.6, filter: 0.45 } as const;

type WordGroup = { text: string; trailing: string };

/**
 * One tokenizer for both modes: a line becomes the words it is made of, each
 * carrying the whitespace that follows it. Word mode animates a group at a
 * time, char mode the characters inside one — so the two can't drift apart on
 * what counts as a word or where a space belongs. Runs of whitespace and tabs
 * survive as their own group rather than collapsing.
 */
function toWordGroups(line: string): WordGroup[] {
  const chunks = line.match(/\S+\s*|\s+/g) ?? [];
  return chunks.map((chunk) => {
    const text = chunk.replace(/\s+$/, "");
    return { text, trailing: chunk.slice(text.length) };
  });
}

export function TextReveal({
  text,
  as: Comp = "span",
  className,
  split = "word",
  stagger = 0.05,
  delay = 0,
  blur = 8,
  yOffset = "30%",
  spring,
  once = true,
  whileInView = false,
  children,
  unitClassName,
}: TextRevealProps) {
  /* JSX resolves a union of tags by intersecting their props, which makes the
     ref type impossible to satisfy (an HTMLDivElement is not an HTMLSpanElement).
     One concrete signature at the boundary — the same shape every tag in
     `TextTag` accepts — keeps the public prop honest and the JSX checkable. */
  const Tag = Comp as unknown as React.ComponentType<{
    ref?: React.Ref<HTMLElement>;
    className?: string;
    children?: ReactNode;
  }>;
  const ref = useRef<HTMLElement>(null);
  // Same trigger line as the page's `[data-reveal]` blocks (`useReveal`): the
  // heading starts as it crosses the lower eighth of the viewport. Waiting for
  // 40% of it to be visible started it late and left the paragraph beside it,
  // which reveals on that line, arriving first.
  const inView = useInView(ref, { once, margin: "0px 0px -12% 0px" });
  const reduce = useReducedMotion();
  const shouldAnimate = whileInView ? inView : true;

  const lines = Array.isArray(text) ? text : [text];
  const offset = typeof yOffset === "number" ? `${yOffset}px` : yOffset;
  const hidden = `translateY(${offset})`;

  let unitIndex = 0;
  const lineCounts = new Map<string, number>();

  return (
    <Tag ref={ref} className={cn("block", className)}>
      {lines.map((line) => {
        const lineCount = lineCounts.get(line) ?? 0;
        lineCounts.set(line, lineCount + 1);
        const lineKey = `${line}-${lineCount}`;
        const unitCounts = new Map<string, number>();

        const renderUnit = (unit: string) => {
          const d = delay + unitIndex * stagger;
          unitIndex += 1;
          const unitCount = unitCounts.get(unit) ?? 0;
          unitCounts.set(unit, unitCount + 1);
          const unitKey = `${unit}-${unitCount}`;
          const initial = reduce
            ? { opacity: 0 }
            : { transform: hidden, opacity: 0, filter: `blur(${blur}px)` };
          const animate = shouldAnimate
            ? reduce
              ? { opacity: 1 }
              : { transform: "translateY(0px)", opacity: 1, filter: "blur(0px)" }
            : initial;
          const transition: Transition = reduce
            ? { opacity: { duration: 0.25, ease: EASE_OUT, delay: d * 0.3 } }
            : {
                transform: spring
                  ? { type: "spring" as const, ...spring, delay: d }
                  : { duration: UNIT_DURATION.transform, ease: EASE_OUT, delay: d },
                opacity: { duration: UNIT_DURATION.opacity, ease: EASE_OUT, delay: d },
                filter: { duration: UNIT_DURATION.filter, ease: EASE_OUT, delay: d },
              };
          return (
            <motion.span
              key={unitKey}
              initial={initial}
              animate={animate}
              transition={transition}
              // `whitespace-pre` is load-bearing: a unit's trailing space is
              // inside an inline-block and would otherwise collapse to zero
              // width, running every word together. No permanent
              // `will-change`: the animations run on the compositor while they
              // play, and a layer kept per word for the life of the page is
              // dozens of idle layers on a long landing.
              className={cn("inline-block whitespace-pre", unitClassName)}
              // `.lp-lumen` draws its bloom from `attr(data-text)`; anything
              // else ignores it.
              data-text={unit}
            >
              {unit}
            </motion.span>
          );
        };

        const groups = toWordGroups(line);
        const groupCounts = new Map<string, number>();

        return (
          <span key={lineKey} className="block">
            {groups.map((group) => {
              const whole = group.text + group.trailing;
              // Characters animate one at a time, but each word (plus the
              // space that follows it) sits in its own inline-block so a long
              // line wraps between words instead of mid-word.
              if (split !== "char") return renderUnit(whole);

              const groupCount = groupCounts.get(whole) ?? 0;
              groupCounts.set(whole, groupCount + 1);
              return (
                <span
                  key={`${whole}-${groupCount}`}
                  className="inline-block whitespace-pre"
                >
                  {Array.from(whole).map((char) => renderUnit(char))}
                </span>
              );
            })}
          </span>
        );
      })}
      {children}
    </Tag>
  );
}
