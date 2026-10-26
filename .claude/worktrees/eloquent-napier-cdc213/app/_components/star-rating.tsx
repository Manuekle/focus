"use client";

import { StarIcon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/icon";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

// Stars, as an input and as a display.
//
// The input is five native radio buttons behind the stars, not five buttons
// with click handlers: a radio group already is one tab stop with arrow keys
// between its options and a checked state a screen reader announces, and
// rebuilding that on divs is how a rating ends up mouse-only.

function Star({ filled, size }: { readonly filled: boolean; readonly size: number }) {
  return (
    <HugeiconsIcon
      icon={StarIcon}
      size={size}
      strokeWidth={1.5}
      fill={filled ? "currentColor" : "none"}
      className={cn(
        "transition-[color,transform] duration-150",
        filled ? "text-amber-400" : "text-muted-foreground/40",
      )}
    />
  );
}

export function StarRating({
  value,
  onChange,
  size = 32,
  disabled,
  labelledBy,
  describedBy,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly size?: number;
  readonly disabled?: boolean;
  readonly labelledBy?: string;
  readonly describedBy?: string;
}) {
  const t = useT();
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex items-center gap-1"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <label
          key={star}
          onMouseEnter={() => !disabled && setHover(star)}
          className={cn(
            "relative grid place-items-center rounded-lg p-1",
            "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-[color:var(--ring)]",
            disabled ? "cursor-default opacity-60" : "cursor-pointer active:scale-95",
          )}
        >
          <input
            type="radio"
            name={name}
            value={star}
            checked={value === star}
            disabled={disabled}
            onChange={() => onChange(star)}
            aria-label={t("review.star", { count: star })}
            className="sr-only"
          />
          <Star filled={star <= shown} size={size} />
        </label>
      ))}
    </div>
  );
}

export function StarsDisplay({
  rating,
  size = 14,
  className,
}: {
  readonly rating: number;
  readonly size?: number;
  readonly className?: string;
}) {
  const t = useT();
  const rounded = Math.round(rating);
  return (
    <span
      role="img"
      aria-label={t("help.starsCount", { count: rating })}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} filled={star <= rounded} size={size} />
      ))}
    </span>
  );
}
