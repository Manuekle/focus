"use client";

import { HugeiconsIcon, type IconSvgElement } from "../icons/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { cn } from "../../lib/utils";

/** One row action: an icon button that says what it does on hover and on
 *  focus. Automation cards and notification cards share it, so the strip
 *  under every nested card is the same control. */
export function RowAction({
  icon,
  label,
  onClick,
  disabled,
  disabledLabel,
  destructive,
}: {
  readonly icon: IconSvgElement;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** Shown instead of `label` when the action is unavailable, so the tooltip
   *  explains the greyed-out button rather than naming an action that won't run. */
  readonly disabledLabel?: string;
  readonly destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button fires no pointer events, so the tooltip would never
            open. It stays enabled and inert instead, with aria-disabled telling
            assistive tech the truth. */}
        <button
          type="button"
          onClick={disabled ? undefined : onClick}
          aria-disabled={disabled}
          aria-label={disabled ? (disabledLabel ?? label) : label}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors",
            disabled
              ? "cursor-not-allowed opacity-30"
              : destructive
                ? "hover:bg-destructive/10 hover:text-destructive"
                : "hover:bg-accent hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={icon} size={16} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{disabled ? (disabledLabel ?? label) : label}</TooltipContent>
    </Tooltip>
  );
}
