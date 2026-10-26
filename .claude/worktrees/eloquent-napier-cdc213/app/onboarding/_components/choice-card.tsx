"use client";

import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { CSSProperties } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import badgeStyles from "@/components/ui/category-badge.module.css";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { ChoiceOption } from "../_lib/questions";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * One answer in a question: a button that is picked or not.
 *
 * `aria-pressed` carries the state, the same contract as `ToggleChip`, so a
 * screen reader announces "pressed" on the answers already given when the
 * owner comes back to a question. The number on the right is the keyboard
 * shortcut the flow listens for; it only shows where there is a keyboard to
 * press it with, and gives way to the check once the answer is picked.
 */
export function ChoiceCard({
  hint,
  index,
  label,
  layout,
  mode,
  onSelect,
  option,
  scale,
  selected,
}: {
  readonly hint?: string;
  readonly index: number;
  readonly label: string;
  readonly layout: "list" | "grid" | "chips";
  readonly mode: "single" | "multi";
  readonly onSelect: () => void;
  readonly option: ChoiceOption;
  /** Length of the volume scale, when the option is drawn as signal bars. */
  readonly scale: number;
  readonly selected: boolean;
}) {
  const reduce = useReducedMotion();
  const chip = layout === "chips";
  const shortcut = index < 9 ? String(index + 1) : null;

  return (
    <motion.button
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-center rounded-xl border text-left",
        "motion-safe:transition-[border-color,background-color,box-shadow] motion-safe:duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        chip ? "min-h-11 gap-2 px-3 py-2" : "min-h-14 gap-3 px-3 py-2.5",
        selected
          ? "border-foreground/25 bg-muted/70 shadow-[var(--shadow-inset)]"
          : "border-border bg-card shadow-[var(--shadow-soft)] hover:border-input hover:bg-muted/35",
      )}
      data-option={option.id}
      initial={reduce ? false : { opacity: 0, transform: "translateY(6px)" }}
      onClick={onSelect}
      transition={{ delay: reduce ? 0 : 0.05 + index * 0.03, duration: 0.32, ease: EASE_OUT }}
      type="button"
      whileTap={reduce ? undefined : { scale: 0.985 }}
    >
      {chip ? null : <OptionTile option={option} scale={scale} selected={selected} />}

      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium leading-snug", chip ? "text-[13px]" : "text-sm")}>{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-muted-foreground text-xs leading-snug">{hint}</span>
        ) : null}
      </span>

      <span className="relative flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        <AnimatePresence initial={false} mode="popLayout">
          {selected ? (
            <motion.span
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "flex size-5 items-center justify-center bg-foreground text-background",
                mode === "single" ? "rounded-full" : "rounded-[6px]",
              )}
              exit={{ opacity: 0, scale: 0.6 }}
              initial={reduce ? false : { opacity: 0, scale: 0.5 }}
              key="check"
              transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.4, visualDuration: 0.28 }}
            >
              <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.6} />
            </motion.span>
          ) : shortcut ? (
            <motion.kbd
              animate={{ opacity: 1 }}
              className={cn(
                "flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border px-1",
                "font-mono text-[10px] text-muted-foreground leading-none",
                "pointer-coarse:hidden",
              )}
              exit={{ opacity: 0 }}
              initial={reduce ? false : { opacity: 0 }}
              key="kbd"
              transition={{ duration: 0.15 }}
            >
              {shortcut}
            </motion.kbd>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

function OptionTile({
  option,
  scale,
  selected,
}: {
  readonly option: ChoiceOption;
  readonly scale: number;
  readonly selected: boolean;
}) {
  // A channel keeps its own colour whether or not it is picked — the tint is
  // how the eye finds WhatsApp in a grid of eight — and the card around it
  // carries the selection. Everything else inverts, like the plan's badges.
  if (option.hue !== undefined && option.icon) {
    return (
      <span
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px]", badgeStyles.badge)}
        style={{ "--category-hue": option.hue } as CSSProperties}
      >
        <HugeiconsIcon icon={option.icon} size={18} strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
        "motion-safe:transition-colors motion-safe:duration-200",
        selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
      )}
    >
      {option.level !== undefined ? (
        <VolumeBars level={option.level} total={scale} />
      ) : option.icon ? (
        <HugeiconsIcon icon={option.icon} size={18} strokeWidth={1.75} />
      ) : null}
    </span>
  );
}

/** Signal bars: how far up the scale an answer sits, readable at a glance. */
function VolumeBars({ level, total }: { readonly level: number; readonly total: number }) {
  const width = 3;
  const gap = 1.5;
  const height = 14;
  const span = total * width + (total - 1) * gap;
  return (
    <svg aria-hidden="true" height={height} viewBox={`0 0 ${span} ${height}`} width={span}>
      {Array.from({ length: total }, (_, index) => {
        const barHeight = height * (0.3 + (0.7 * index) / Math.max(1, total - 1));
        return (
          <rect
            fill="currentColor"
            height={barHeight}
            key={index}
            opacity={index < level ? 1 : 0.22}
            rx={1}
            width={width}
            x={index * (width + gap)}
            y={height - barHeight}
          />
        );
      })}
    </svg>
  );
}
