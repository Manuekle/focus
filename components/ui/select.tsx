"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "../icons/icon";
import { cn } from "../../lib/utils";
import { FIELD_FOCUS } from "./input";

// The system's dropdown field: the trigger is an Input-sized surface, the list
// is the same popover surface as the account menu. Native <select> paints its
// own popup, which ignores the theme.

export type SelectOption = { readonly value: string; readonly label: React.ReactNode };

export function Select({
  value,
  onValueChange,
  options,
  id,
  disabled,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly id?: string;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly "aria-label"?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        data-slot="select-trigger"
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-muted pl-3.5 pr-3 py-1 text-left text-[length:var(--field-text-size)] leading-5 text-foreground shadow-[var(--shadow-inset)] transition-[background-color,border-color,box-shadow] duration-150 ease-out outline-none data-[placeholder]:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          FIELD_FOCUS,
          "aria-invalid:border-destructive",
          className,
        )}
      >
        <span className="min-w-0 truncate"><SelectPrimitive.Value placeholder={placeholder} /></span>
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.75} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="text-primary">
                  <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
