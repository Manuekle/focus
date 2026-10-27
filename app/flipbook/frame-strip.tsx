"use client";

import type { KeyboardEvent } from "react";
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { flipbookUrls, type Flipbook, type FlipbookFrame } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const STATE_LABEL: Record<FlipbookFrame["status"], string> = {
  pending: "Not drawn",
  generating: "Drawing",
  processing: "Cutting out",
  ready: "Ready",
  failed: "Failed",
};

export function frameThumb(flipbook: Flipbook, frame: FlipbookFrame): string | null {
  const transform = flipbook.alignment?.transforms[frame.id];
  // The registered sprite of the current drawing, also while a redraw of it is running.
  if (transform && transform.version === frame.version) return flipbookUrls.sprite(flipbook.id, frame.id, transform.key);
  return null;
}

/**
 * The frame strip: every drawing in playback order. Arrow keys move the
 * selection; Alt + arrow moves the selected drawing earlier or later.
 */
export function FrameStrip({
  flipbook,
  frames,
  selected,
  onSelect,
  onMove,
  disabled,
}: {
  readonly flipbook: Flipbook;
  readonly frames: readonly FlipbookFrame[];
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly disabled: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(frames.length - 1, selected + delta));
    if (event.altKey) {
      if (!disabled && target !== selected) onMove(selected, target);
      return;
    }
    onSelect(target);
    (event.currentTarget.querySelectorAll("button")[target] as HTMLButtonElement | undefined)?.focus();
  };

  return (
    <ol className={styles.strip} aria-label="Frames in playback order. Alt plus arrow keys reorder." onKeyDown={onKeyDown}>
      {frames.map((frame, index) => {
        const thumb = frameThumb(flipbook, frame);
        const flagged = frame.warnings.length > 0 || (frame.review && !frame.review.ok);
        return (
          <li key={frame.id}>
            <button
              type="button"
              className={cn(styles.stripFrame, index === selected && styles.stripFrameActive)}
              aria-current={index === selected ? "true" : undefined}
              aria-label={`Frame ${index + 1}, ${frame.label}, ${STATE_LABEL[frame.status]}${frame.approved ? ", approved" : ""}${flagged ? ", needs a look" : ""}`}
              tabIndex={index === selected ? 0 : -1}
              onClick={() => onSelect(index)}
              data-status={frame.status}
            >
              <span className={styles.stripThumb} data-transparent="">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- versioned sprite from the media route
                  <img src={thumb} alt="" draggable={false} />
                ) : frame.status === "generating" || frame.status === "processing" ? (
                  <Spinner className="size-4 text-muted-foreground" />
                ) : (
                  <span className={styles.stripEmpty}>{frame.status === "failed" ? "Failed" : "—"}</span>
                )}
                {frame.approved ? <span className={styles.badgeApproved} aria-hidden><HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.2} /></span> : null}
                {flagged ? <span className={styles.badgeWarning} aria-hidden><HugeiconsIcon icon={Alert02Icon} size={11} strokeWidth={2} /></span> : null}
              </span>
              <span className={styles.stripMeta}>
                <span className="tabular-nums">{index + 1}</span>
                <span className={styles.stripLabel}>{frame.label}</span>
              </span>
              <span className={styles.stripState}>{STATE_LABEL[frame.status]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
