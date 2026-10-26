import * as React from "react";

import { cn } from "../../lib/utils";

/** Shared focus for every text field: Input, Textarea and SelectTrigger.
 *  An invalid field keeps the error treatment while focused — red border
 *  and red halo instead of the default blue — so the error never reads as
 *  resolved until the value actually is. */
export const FIELD_FOCUS =
  "focus-visible:border-[var(--field-focus-border)] focus-visible:bg-card focus-visible:ring-0 focus-visible:shadow-[var(--field-focus-shadow)]"
  + " focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-transparent"
  + " aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:shadow-[var(--field-error-shadow)]";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-muted pl-3.5 pr-3.5 py-1 text-[length:var(--field-text-size)] leading-5 shadow-[var(--shadow-inset)] transition-[background-color,border-color,box-shadow] duration-150 ease-out outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        type === "number" && "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        // Focus is the buttons' blue: the border turns blue and a soft halo
        // hugs it (`--field-focus-shadow`), with no gap between field and
        // ring. The transparent outline is what forced-colors mode repaints.
        FIELD_FOCUS,
        "text-ellipsis focus:text-clip",
        "aria-invalid:border-destructive aria-invalid:shadow-[inset_0_-1px_0_oklch(0.54_0.22_27.325/0.15)] dark:aria-invalid:shadow-[inset_0_-1px_0_oklch(0.637_0.193_21.4/0.15)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
