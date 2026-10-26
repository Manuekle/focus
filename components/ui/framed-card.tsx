"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The frame every card the agent draws in the chat is built from.
 *
 * The rest of the console already had one card language and the transcript did
 * not. `/settings`, `/setup`, `/runtime`, `/forms` and the composer all draw
 * the same double frame — a muted outer surface
 * (`rounded-[20px] border-border/70 bg-muted/50 p-1.5`) holding an inset panel
 * (`rounded-[14px] border-border/50 bg-card shadow-xs`), with status and
 * actions in the gap below the panel rather than inside it. In `/chat` a
 * question was a single-border box, a tool call had no frame at all and a
 * chart was a bare figure, so the three things the agent puts on screen read
 * as three different products stacked on each other.
 *
 * The tokens are copied from `app/(app)/settings/page.tsx` on purpose: same
 * radii, same border alphas, same shadow variables. Change them here and the
 * transcript drifts away from the pages it sits next to.
 *
 * ## The two knobs
 *
 * `size` is how much frame the content earns. `default` is the settings
 * geometry and belongs to things that are their own object — a question, a
 * chart, a report. `compact` (16/12, half the gap) is for the tool
 * disclosures: a transcript can hold twenty of them, and twenty full-size
 * bento cards is a wall.
 *
 * `tone` is how much of the reader's attention the card still wants.
 * `default` is live — the float shadow lifts it off the page. `quiet` is
 * settled: the frame stays so the transcript keeps its rhythm, but the fill
 * drops back and the shadow goes flat, which is what the old card was saying
 * by erasing its background entirely.
 */

type CardSize = "compact" | "default";
type CardTone = "default" | "quiet";

const OUTER_SIZE: Record<CardSize, string> = {
  compact: "rounded-[16px] p-1",
  default: "rounded-[20px] p-1.5",
};

/** Inner radius is the outer one minus the gap, or the corners stop being concentric. */
const PANEL_SIZE: Record<CardSize, string> = {
  compact: "rounded-[12px]",
  default: "rounded-[14px]",
};

const OUTER_TONE: Record<CardTone, string> = {
  default: "border-border/70 bg-muted/50",
  quiet: "border-border/60 bg-muted/30",
};

const PANEL_TONE: Record<CardTone, string> = {
  default: "border-border/50 bg-card shadow-xs",
  quiet: "border-border/40 bg-card/60",
};

export type FramedCardProps = ComponentPropsWithoutRef<"div"> & {
  /** The element to render. A question is a `section`, a chart a `figure`. */
  readonly as?: "article" | "div" | "figure" | "section";
  readonly children: ReactNode;
  readonly size?: CardSize;
  readonly tone?: CardTone;
};

export function FramedCard({
  as: Tag = "div",
  children,
  className,
  size = "default",
  tone = "default",
  ...props
}: FramedCardProps) {
  return (
    <Tag
      className={cn(
        "w-full border",
        // `tone` flips while the card is on screen — a question settles, a
        // tool call finishes — so the fill, the hairline and the shadow are
        // tweened. Without this the frame changed colour in one frame under
        // content that was still animating, which is the jump that reads as a
        // glitch rather than as a state change.
        "transition-[background-color,border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        OUTER_SIZE[size],
        OUTER_TONE[tone],
        tone === "quiet" || size === "compact"
          ? "shadow-[var(--shadow-soft)]"
          : "shadow-[var(--shadow-float)]",
        className,
      )}
      data-framed-card={size}
      {...props}
    >
      {children}
    </Tag>
  );
}

/**
 * The inset panel: the card's actual content.
 *
 * `overflow-hidden` is not optional — a table, a code block or a Mermaid SVG
 * that reaches the edge would otherwise square off the corners the frame
 * exists to draw.
 */
export function FramedCardPanel({
  children,
  className,
  size = "default",
  tone = "default",
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  readonly children: ReactNode;
  readonly size?: CardSize;
  readonly tone?: CardTone;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden border",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        PANEL_SIZE[size],
        PANEL_TONE[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The strip in the gap around the panel, where the status and the actions live.
 *
 * Settings puts the configured count and the Configure button here rather than
 * inside the panel, and the split is what makes those cards readable: the
 * panel says what the thing is, the strip says where it stands and what you
 * can do about it. `min-h-9` keeps it from collapsing when it holds one line
 * of text, so a row of cards still lines up.
 *
 * `place="top"` is the same strip above the panel, for a card tall enough that
 * a control at its foot is a scroll away — a report runs to a couple of
 * thousand pixels, and its download button has to be where the reader starts.
 */
export function FramedCardFooter({
  children,
  className,
  place = "bottom",
  size = "default",
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  readonly children: ReactNode;
  readonly place?: "bottom" | "top";
  readonly size?: CardSize;
}) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground",
        compact ? "px-2" : "px-2.5",
        place === "top"
          ? compact
            ? "pt-0.5 pb-1.5"
            : "pt-0.5 pb-2"
          : compact
            ? "pt-1.5 pb-0.5"
            : "pt-2 pb-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
