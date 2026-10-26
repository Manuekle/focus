"use client";

import type { ReactNode } from "react";
import { CheckIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../icons/icon";
import { cn } from "../../lib/utils";

/** The model picker's existing row, shared with the agent's voice picker. */
export function SelectionRow({
  label, hint, hintTone = "muted", badge, mark, selected, strike, disabled,
  onSelect, action, selectionLabel, semantics = "radio",
}: {
  readonly label: string;
  readonly hint?: string;
  readonly hintTone?: "muted" | "warn";
  readonly badge?: ReactNode;
  readonly mark?: ReactNode;
  readonly selected: boolean;
  readonly strike?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
  readonly action?: ReactNode;
  readonly selectionLabel?: string;
  readonly semantics?: "radio" | "toggle";
}) {
  const rowClassName = cn(
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
    selected ? "bg-muted" : "hover:bg-muted/60",
    disabled && "cursor-not-allowed opacity-60",
  );
  const control = (
    <button
      type="button"
      role={semantics === "radio" ? "radio" : undefined}
      aria-checked={semantics === "radio" ? selected : undefined}
      aria-pressed={semantics === "toggle" ? selected : undefined}
      aria-label={selectionLabel}
      disabled={disabled}
      onClick={onSelect}
      className={action ? "flex min-w-0 flex-1 items-center gap-3 self-stretch text-left" : rowClassName}
    >
      {mark ? <span className="shrink-0 text-foreground">{mark}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-sm", strike && "text-muted-foreground line-through")}>
            {label}
          </span>
          {badge}
        </span>
        {hint ? (
          <span className={cn(
            "mt-0.5 block truncate text-[11px] tabular-nums",
            hintTone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}>{hint}</span>
        ) : null}
      </span>
      <span aria-hidden="true" className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
        selected ? "border-primary bg-primary" : "border-border",
      )}>
        {selected ? <HugeiconsIcon icon={CheckIcon} size={11} strokeWidth={3} className="text-primary-foreground" /> : null}
      </span>
    </button>
  );

  if (!action) return control;
  return <div className={rowClassName}>{control}<span className="shrink-0">{action}</span></div>;
}
