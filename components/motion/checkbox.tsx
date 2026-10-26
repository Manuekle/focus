"use client";

import { MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "../icons/icon";

import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  indeterminate?: boolean;
  label?: ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
  /** Associates an external message (e.g. a form error) with the control. */
  "aria-describedby"?: string;
}

/** Shared mark for controls and decorative selections inside menus. */
export function CheckboxMark({
  indeterminate,
  className,
}: {
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <HugeiconsIcon icon={indeterminate ? MinusSignIcon : Tick02Icon} size={16} strokeWidth={1.75} className={className} />
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  indeterminate,
  label,
  className,
  id: idProp,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: CheckboxProps) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex items-center gap-3",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <button
        id={id}
        type="button"
        role="checkbox"
        // Checked/unchecked is a switch, so it gets the switch cue instead of
        // the generic press the provider falls back to.
        data-cuelume-toggle
        aria-checked={indeterminate ? "mixed" : checked}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        data-state={
          indeterminate ? "indeterminate" : checked ? "checked" : "unchecked"
        }
        // The box (surface, edge, focus, checked fill) is `.ui-check` in
        // globals.css, shared with native checkboxes; `.t-check` draws the mark.
        className="ui-check t-check"
      >
        <CheckboxMark indeterminate={indeterminate} />
      </button>
      {label ? (
        <span className={cn("min-w-0 select-none text-sm text-foreground", disabled && "opacity-[0.42]")}>
          {label}
        </span>
      ) : null}
    </label>
  );
}
