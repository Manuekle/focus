"use client";

import type * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "../../lib/utils";

/** A single-value slider using the same surfaces and focus tokens as Input. */
export function Slider({
  id,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-valuetext": ariaValueText,
  ...props
}: Omit<React.ComponentProps<typeof SliderPrimitive.Root>, "orientation">) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex min-h-6 w-full min-w-0 touch-none items-center select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [@media(pointer:coarse)]:min-h-8", className)}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1 w-full grow overflow-hidden rounded-full bg-input">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-valuetext={ariaValueText}
        className="relative block size-3.5 rounded-full border border-input bg-card shadow-[var(--shadow-soft)] outline-none after:absolute after:-inset-1.5 after:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--btn-focus-ring)] forced-colors:border-[ButtonText] forced-colors:focus-visible:outline-[Highlight] [@media(pointer:coarse)]:size-5"
      />
    </SliderPrimitive.Root>
  );
}
