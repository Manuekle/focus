"use client";

import { AiPaintbrushIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { EXPOSURE_FPS, denseInbetweenTargets, exposureSheet, playbackCycle, type DrawingFps, type Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

/**
 * In-betweens fill the exposure slots between the key poses. The cost is
 * stated before anything is drawn; past the budget, the
 * editor's usual confirmation asks first.
 */
export function InbetweenPanel({
  flipbook,
  drawingFps,
  cycleSeconds,
  keysReady,
  disabled,
  onDraw,
}: {
  readonly flipbook: Flipbook;
  readonly drawingFps: DrawingFps;
  readonly cycleSeconds?: number;
  /** Every key drawing is finished and registered. */
  readonly keysReady: boolean;
  readonly disabled: boolean;
  readonly onDraw: () => void;
}) {
  const targets = denseInbetweenTargets(flipbook, drawingFps).length;
  const cycle = playbackCycle(flipbook, true);
  const current = cycle.filter((drawing) => drawing.inbetween).length;
  const sheet = exposureSheet(cycle, drawingFps, cycleSeconds);
  const actualFps = Math.round((sheet.drawings.length * EXPOSURE_FPS) / sheet.holds.reduce((sum, hold) => sum + hold, 0));
  const { used, limit } = flipbook.budget;
  const over = Math.max(0, used + targets - limit);
  const noun = targets === 1 ? "in-between" : "in-betweens";

  return (
    <section className={styles.panel} aria-labelledby="inbetween-title">
      <div className={styles.panelHead}>
        <h2 id="inbetween-title" className={styles.panelTitle}>In-betweens</h2>
        <Badge>{actualFps} drawings/s</Badge>
      </div>
      <p className={styles.hint}>Add the missing poses between key drawings. Cycle length sets the speed; MP4 plays at 60 fps.</p>
      {targets ? (
        <>
          <Button size="sm" variant="ai" disabled={disabled || !keysReady} onClick={onDraw}>
            <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />Draw {targets} {noun} · {targets} {targets === 1 ? "drawing" : "drawings"}
          </Button>
          <p className="text-[11px] leading-4 text-muted-foreground" data-testid="inbetween-cost">
            {!keysReady
              ? "Finish every key drawing first."
              : over > 0
                ? `That is ${over} past this animation’s budget (${used} of ${limit} used); you’ll be asked to confirm.`
                : `Drawings ${used}/${limit} used now; this brings it to ${used + targets}/${limit}.`}
            {current ? " A redrawn or moved pose needs its in-between drawn again." : ""}
          </p>
        </>
      ) : <p className={styles.hint}>All the poses are ready. You can change the cycle length without drawing them again.</p>}
    </section>
  );
}
