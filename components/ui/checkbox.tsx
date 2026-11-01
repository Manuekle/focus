"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

/**
 * Checkbox: the primary button's blue surface at 16px, with the tick drawn in.
 *
 * Surface, edge and press live in `.ui-check`; the draw lives in `.t-check`
 * (styles/recipes.css), keyed off radix's `data-state`. The tick is Hugeicons'
 * Tick02 path, inlined so its stroke can be dashed — 21 is its length on the
 * 24px grid. The mark is always mounted so unchecking draws it back out.
 */
function Checkbox({ className, style, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn("ui-check t-check", className)}
      style={{ "--check-len": 21, ...style } as React.CSSProperties}
      {...props}
    >
      {/* 1.75 matches the native box's mask; `.t-check svg` sets a thinner default. */}
      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 1.75 }}>
        <path d="M5 14L8.5 17.5L19 6.5" />
      </svg>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
