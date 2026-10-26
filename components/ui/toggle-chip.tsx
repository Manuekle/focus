import * as React from "react";

import { Button } from "./button";
import { cn } from "../../lib/utils";

// A chip that is either picked or not: the language row in the agent brief,
// the template row in the create dialog, the choice filter on a form step.
//
// All three were hand-written, and all three had drifted apart — one used
// `bg-muted` for the picked state and another `bg-accent`, one bordered at
// `foreground/30` and another at `/40`, and only two of the three set
// `aria-pressed`, so on the third a screen reader announced a plain button
// with no state at all. `aria-pressed` is not optional here and is set from
// `selected` rather than left to the caller.
//
// The surface comes from the system `Button`, which is what puts the chip back
// on the app's 10/8px radius — the copies were `rounded-full`, a pill the
// button scale does not define anywhere.
export function ToggleChip({
  selected,
  size = "sm",
  className,
  ...props
}: React.ComponentProps<typeof Button> & { readonly selected: boolean }) {
  return (
    <Button
      type="button"
      variant={selected ? "secondary" : "outline"}
      size={size}
      aria-pressed={selected}
      className={cn(
        "font-normal",
        selected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
