import * as React from "react";

import { Button } from "./button";
import { cn } from "../../lib/utils";

// The starter-prompt chip: a tappable suggestion that seeds a conversation.
// It shows up in five places — the agent builder's assistant, the automation
// flow's assistant, the agent chat's empty state, the home agent chat, and the
// follow-up options inside an assistant turn.
//
// Every one of those had its own hand-written copy, and they had drifted:
// three padding scales, two hover foreground tokens, and `active:scale` on
// some but not others. Worse, they were `rounded-full` — a pill radius the
// app's button scale (12/10/8px) does not have anywhere else, so the chips
// read as borrowed from another product.
//
// Building on `Button variant="outline"` is what fixes that at the root: the
// radius, focus ring, disabled treatment, and press language all come from the
// one place that defines them. Only the chip's own surface is added on top —
// the opaque `bg-card`: the beam these chips sit inside paints its core
// behind the child, and a half-transparent surface lets it read through.
export function SuggestionChip({
  size = "sm",
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      // No hover cue: a row of chips is scanned with the pointer, and a sound
      // on every pass is noise. The press is the provider's subtle tap.
      className={cn(
        "bg-card font-normal text-muted-foreground",
        "hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
