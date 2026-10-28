"use client";

import { AiPaintbrushIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { exposureSheet, inbetweenTargets, playbackCycle, type DrawingFps, type Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

/**
 * In-betweens: one drawing halfway between each pair of key poses, made from
 * both. The cost is stated before anything is drawn; past the budget, the
 * editor's usual confirmation asks first.
 */
export function InbetweenPanel({
  flipbook,
  drawingFps,
  keysReady,
  disabled,
  onDraw,
}: {
  readonly flipbook: Flipbook;
  readonly drawingFps: DrawingFps;
  /** Every key drawing is finished and registered. */
  readonly keysReady: boolean;
  readonly disabled: boolean;
  readonly onDraw: () => void;
}) {
  const keys = flipbook.order.length;
  const targets = inbetweenTargets(flipbook).length;
  const cycle = playbackCycle(flipbook, true);
  const current = cycle.filter((drawing) => drawing.inbetween).length;
  const shown = exposureSheet(cycle, drawingFps).drawings.filter((drawing) => drawing.inbetween).length;
  const { used, limit } = flipbook.budget;
  const over = Math.max(0, used + targets - limit);
  const noun = targets === 1 ? "in-between" : "in-betweens";

  return (
    <section className={styles.panel} aria-labelledby="inbetween-title">
      <div className={styles.panelHead}>
        <h2 id="inbetween-title" className={styles.panelTitle}>In-betweens</h2>
        {current ? <span className={styles.pill}>{current}/{keys} drawn</span> : null}
      </div>
      <p className={styles.hint}>One drawing halfway between each pair of poses, made from both. The poses keep their holds and the in-betweens play on ones, so the motion flows like hand-drawn anime.</p>
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
      ) : <p className={styles.hint}>Every in-between matches the current drawings.</p>}
      {current && shown < current ? <p className={styles.hint}>At {drawingFps} drawings per second, a pose held for a single frame leaves no room: {shown} of {current} play. Choose 8 to see them all.</p> : null}
    </section>
  );
}
