"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import {
  GooFilterDefs,
  GooItems,
  GooSurface,
  gooShape,
  useGooProgress,
} from "./goo";

export type GooeyDropdownProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  className?: string;
  panelClassName?: string;
  side?: "top" | "bottom";
  triggerWidth?: number;
  triggerHeight?: number;
  panelHeight?: number;
};

/**
 * A dropdown whose menu falls out of its own trigger as a drop of liquid.
 *
 * The trigger's body and the panel go through ONE goo filter, so the panel is
 * torn off the trigger through a neck that thins and pinches. The trigger's
 * visible fill and label, and the menu's items, are painted opaque on top of
 * that and never enter the filter — a blur plus a hard alpha threshold turns
 * text into ghosts, which is exactly what the old version did.
 *
 * The sheet that peels off is the trigger's own width and stays that width the
 * whole way: nothing here ever moves sideways.
 */
export function GooeyDropdown({
  trigger,
  children,
  open,
  className,
  panelClassName,
  side = "bottom",
  triggerWidth = 200,
  triggerHeight = 40,
  panelHeight = 146,
}: GooeyDropdownProps) {
  const filterId = `goo-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const p = useGooProgress(open);
  const shape = gooShape(p, { triggerHeight, panelHeight });
  const flip = side === "top";

  return (
    <div
      className={cn("relative inline-block", className)}
      style={{ width: triggerWidth, height: triggerHeight }}
    >
      <GooFilterDefs id={filterId} />

      <GooSurface
        shape={shape}
        filterId={filterId}
        triggerWidth={triggerWidth}
        triggerHeight={triggerHeight}
        sheetWidth={triggerWidth}
        flip={flip}
      />

      {/* Opaque, on top, outside the filter. */}
      <div className="relative z-10" style={{ width: triggerWidth, height: triggerHeight }}>
        {trigger}
      </div>

      {p > 0.001 ? (
        <div
          className={cn("absolute z-10 overflow-hidden", panelClassName)}
          style={{
            left: 0,
            width: triggerWidth,
            height: shape.height,
            borderRadius: shape.radius,
            [flip ? "bottom" : "top"]: shape.topEdge,
            pointerEvents: open ? "auto" : "none",
          }}
        >
          <GooItems height={shape.height}>{children}</GooItems>
        </div>
      ) : null}
    </div>
  );
}

export { GooItems };
