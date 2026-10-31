"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { MediaImage } from "../../components/ui/media-image";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { rotoscopeUrls, type RotoscopeFrame, type RotoscopeLive, type RotoscopeRun } from "../../shared/rotoscope";
import styles from "./rotoscope-canvas.module.css";

/** Height the tray and the drawing controls take from the bottom of the canvas. */
export const TRAY_RESERVE = 250;

type Item = {
  readonly attempt: number;
  readonly kind: "live" | "approved" | "passed" | "rejected";
  /** Its cut-out drawing can be fetched. */
  readonly image: boolean;
  /** Spoken and tooltip text; the thumbnail itself carries only a number and an icon. */
  readonly label: string;
};

/** The attempt in progress first, then the recorded ones, newest to oldest. */
export function trayItems(frame: RotoscopeFrame, live: RotoscopeLive | null): Item[] {
  const items: Item[] = [];
  if (live && !frame.attempts.some((entry) => entry.attempt === live.attempt)) {
    items.push({ attempt: live.attempt, kind: "live", image: live.image, label: `in progress, ${live.stage}` });
  }
  for (const entry of [...frame.attempts].reverse()) {
    const approved = frame.approvedAttempt === entry.attempt;
    const label = approved ? "approved" : entry.passed ? "passed" : "rejected";
    items.push({ attempt: entry.attempt, kind: label, image: true, label });
  }
  return items;
}

/**
 * Every attempt of one frame, in a sheet that rises from the bottom of the
 * canvas. However many attempts there are, they sit in one row that scrolls
 * sideways (wheel included) and opens on the one the inspector is showing; each
 * attempt lands a beat after the last, and a new one joins at the front while the
 * run draws.
 */
export function AttemptTray({ run, frame, items, current, open, onPick, onClose }: {
  readonly run: RotoscopeRun;
  readonly frame: RotoscopeFrame;
  readonly items: readonly Item[];
  /** The attempt the inspector is showing. */
  readonly current: number | null;
  readonly open: boolean;
  readonly onPick: (attempt: number) => void;
  readonly onClose: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  // Open on the attempt being looked at, and follow it when it changes.
  useEffect(() => {
    const strip = row.current;
    const target = strip?.querySelector<HTMLElement>('[data-current="true"]');
    if (!strip || !target) return;
    strip.scrollTo({ left: target.offsetLeft - (strip.clientWidth - target.offsetWidth) / 2, behavior: "smooth" });
  }, [current]);

  // A mouse wheel scrolls the row sideways. Native and non-passive, or preventDefault is ignored.
  useEffect(() => {
    const strip = row.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div className={styles.tray} data-open={open} role="group" aria-label={`Frame ${frame.index}, ${items.length === 1 ? "1 attempt" : `${items.length} attempts`}`} onKeyDown={handleKeyDown}>
      <Button type="button" size="icon-xs" variant="outline" className={styles.trayClose} aria-label="Close attempts" onClick={onClose}>
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
      </Button>
      <div ref={row} className={styles.trayRow}>
        {items.map((item, position) => (
          <button
            key={item.attempt}
            type="button"
            className={styles.attempt}
            data-kind={item.kind}
            data-current={item.attempt === current}
            aria-current={item.attempt === current ? "true" : undefined}
            style={{ "--i": Math.min(position, 8) } as CSSProperties}
            title={`Attempt ${item.attempt}, ${item.label}`}
            aria-label={`Attempt ${item.attempt}, ${item.label}`}
            onClick={() => onPick(item.attempt)}
          >
            <span className={styles.attemptThumb} data-transparent="">
              {item.image ? (
                <MediaImage src={rotoscopeUrls.media(run.id, "attempt", frame.index, item.attempt)} alt="" draggable={false} decoding="async" loading="lazy" />
              ) : <Skeleton className={styles.working} />}
              <span className={styles.attemptBadge} aria-hidden>
                {item.kind === "live" ? <Spinner className="size-2.5" /> : <HugeiconsIcon icon={item.kind === "rejected" ? Cancel01Icon : Tick02Icon} size={10} strokeWidth={2.4} />}
              </span>
            </span>
            <span className={styles.attemptNumber}>{item.attempt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
