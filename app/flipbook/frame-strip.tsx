"use client";

import type { KeyboardEvent } from "react";
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Skeleton } from "../../components/ui/skeleton";
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
  scene = false,
}: {
  readonly flipbook: Flipbook;
  readonly frames: readonly FlipbookFrame[];
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly disabled: boolean;
  /** A scene's drawings are beats of one choreography: small thumbnails, and no reordering. */
  readonly scene?: boolean;
}) {
  const pageSize = 24;
  const start = Math.floor(Math.min(selected, frames.length - 1) / pageSize) * pageSize;
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(frames.length - 1, selected + delta));
    if (event.altKey) {
      if (!scene && !disabled && target !== selected) onMove(selected, target);
      return;
    }
    onSelect(target);
    const list = event.currentTarget;
    requestAnimationFrame(() => (list.querySelector(`[data-frame-index="${target}"]`) as HTMLButtonElement | null)?.focus());
  };

  return (
    <>
    <ol key={start} className={styles.strip} data-dense={scene || undefined} aria-label={scene ? "Drawings in order" : "Frames in playback order. Alt plus arrow keys reorder."} onKeyDown={onKeyDown}>
      {frames.slice(Math.max(0, start), start + pageSize).map((frame, offset) => {
        const index = start + offset;
        const thumb = frameThumb(flipbook, frame);
        const flagged = frame.warnings.length > 0 || (frame.review && !frame.review.ok);
        return (
          <li key={frame.id}>
            <button
              type="button"
              data-frame-index={index}
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
                  <img src={`${thumb}&thumb=1`} alt="" draggable={false} loading="lazy" decoding="async" />
                ) : frame.status === "generating" || frame.status === "processing" ? (
                  <Skeleton className={styles.working} delay={index * 90} />
                ) : (
                  <span className={styles.stripEmpty}>{frame.status === "failed" ? "Failed" : "—"}</span>
                )}
                {frame.approved ? <span className={styles.badgeApproved} aria-hidden><HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.2} /></span> : null}
                {flagged ? <span className={styles.badgeWarning} aria-hidden><HugeiconsIcon icon={Alert02Icon} size={11} strokeWidth={2} /></span> : null}
              </span>
              <span className={styles.stripMeta}>
                <span className="tabular-nums">{index + 1}</span>
                <span className={styles.stripLabel}>{flipbook.sequence ? `${(Number(frame.id.slice(1)) / 24).toFixed(2)} s` : frame.label}</span>
              </span>
              <span className={styles.stripState}>{STATE_LABEL[frame.status]}</span>
            </button>
          </li>
        );
      })}
    </ol>
    {frames.length > pageSize ? <nav className={styles.pager} aria-label="Drawing pages">
      <button type="button" disabled={start === 0} onClick={() => onSelect(Math.max(0, start - pageSize))}>Previous drawings</button>
      <span className={styles.hint}>{start + 1}–{Math.min(start + pageSize, frames.length)} of {frames.length}</span>
      <button type="button" disabled={start + pageSize >= frames.length} onClick={() => onSelect(start + pageSize)}>Next drawings</button>
    </nav> : null}
    </>
  );
}
