import * as React from "react";

import { cn } from "../../lib/utils";
import { FIELD_FOCUS } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex resize-none field-sizing-content min-h-[var(--field-textarea-min-height)] w-full rounded-lg border border-input bg-muted px-3.5 py-2 md:py-2.5 text-[length:var(--field-text-size)] leading-5 shadow-[var(--shadow-inset)] transition-[background-color,border-color,box-shadow] duration-150 ease-out outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:shadow-[inset_0_-1px_0_oklch(0.54_0.22_27.325/0.15)] dark:aria-invalid:shadow-[inset_0_-1px_0_oklch(0.637_0.193_21.4/0.15)]",
        FIELD_FOCUS,
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
