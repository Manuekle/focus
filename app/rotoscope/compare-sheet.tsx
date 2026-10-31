"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { ImageViewer, ImageViewerContent, ImageViewerThumbnail, type ImageViewerImage } from "../../components/motion/image-viewer";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { FRAME_SIZE, rotoscopeUrls, type RotoscopeFrame, type RotoscopeRun } from "../../shared/rotoscope";
import { time } from "./frame-state";
import styles from "./rotoscope.module.css";

/**
 * One frame, three pictures side by side: the video frame it copies, the pose
 * guide measured from it, and the drawing of a chosen attempt. Flip through the
 * attempts below to see which one follows the video best; the arrows (or the
 * keys) move to the next frame without leaving.
 */
export function CompareSheet({ run, frame, initialAttempt, onFrame, canApprove, busy, onApprove, onClose }: {
  readonly run: RotoscopeRun;
  readonly frame: RotoscopeFrame;
  /** The attempt the inspector was showing when the sheet opened. */
  readonly initialAttempt: number | null;
  readonly onFrame: (index: number) => void;
  /** The person may choose the drawing here (the run is idle and the frame is next or already approved). */
  readonly canApprove: boolean;
  readonly busy: boolean;
  readonly onApprove: (attempt: number) => void;
  readonly onClose: () => void;
}) {
  const attempts = [...frame.attempts].reverse();
  const [chosen, setChosen] = useState<number | null>(null);
  const attempt = chosen ?? initialAttempt ?? frame.approvedAttempt ?? attempts[0]?.attempt ?? null;
  const record = frame.attempts.find((entry) => entry.attempt === attempt) ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);
  // A picture opened large; while it is open the sheet leaves the keys to it.
  const [zoomed, setZoomed] = useState<number | null>(null);
  const first = frame.index <= 1;
  const last = frame.index >= run.frames.length;

  // A new frame starts on its own best attempt.
  useEffect(() => { setChosen(null); }, [frame.index]);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The lightbox handles (and marks as handled) the keys while a picture is open large.
      if (zoomed !== null || event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if (event.key === "ArrowLeft" && !first) { event.preventDefault(); onFrame(frame.index - 1); }
      else if (event.key === "ArrowRight" && !last) { event.preventDefault(); onFrame(frame.index + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first, last, frame.index, onFrame, onClose, zoomed]);

  const panes = [
    { key: "video", label: "Video", src: rotoscopeUrls.media(run.id, "source", frame.index), alt: `Video frame ${frame.index}`, transparent: false },
    { key: "guide", label: "Pose guide", src: rotoscopeUrls.guide(run, frame.index), alt: `Pose guide for frame ${frame.index}`, transparent: false },
    { key: "drawing", label: attempt === null ? "Drawing" : `Drawing · attempt ${attempt}`, src: attempt === null ? null : rotoscopeUrls.media(run.id, "attempt", frame.index, attempt), alt: `Attempt ${attempt}`, transparent: true },
  ];

  // Only the pictures that exist can open large; the arrow keys walk them in the lightbox.
  const shown = panes.flatMap((pane) => (pane.src ? [{ ...pane, src: pane.src }] : []));
  const items: ImageViewerImage[] = shown.map((pane) => ({ id: pane.key, width: FRAME_SIZE.width, height: FRAME_SIZE.height, src: pane.src, alt: pane.alt, caption: `Frame ${frame.index} · ${pane.label}`, transparent: pane.transparent }));

  return (
    <div className={styles.compare} role="dialog" aria-label={`Compare frame ${frame.index}`}>
      <div className={styles.compareHead}>
        <span className={styles.compareTitle}>Frame {frame.index} <span>· {time(run, frame.index)}</span></span>
        <div className={styles.compareNav}>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Previous frame" disabled={first} onClick={() => onFrame(frame.index - 1)}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={1.75} />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Next frame" disabled={last} onClick={() => onFrame(frame.index + 1)}>
            <HugeiconsIcon icon={ArrowRight01Icon} size={15} strokeWidth={1.75} />
          </Button>
          <Button ref={closeRef} type="button" size="icon-xs" variant="ghost" aria-label="Close compare" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      <ImageViewer
        images={items}
        label="Frame pictures"
        value={zoomed !== null ? shown[zoomed]?.key ?? null : null}
        onValueChange={(id) => setZoomed(id === null ? null : shown.findIndex((entry) => entry.key === id))}
      >
        <div className={styles.compareBody} key={frame.index}>
          {panes.map((pane) => (
            <figure key={pane.key} className={styles.comparePane}>
              {pane.src ? (
                <ImageViewerThumbnail
                  key={pane.src}
                  imageId={pane.key}
                  className={`${styles.compareImage} rounded-xl bg-transparent`}
                  imageClassName={styles.arrive}
                  data-transparent={pane.transparent ? "" : undefined}
                  onErrorCapture={(event) => { (event.target as HTMLElement).style.visibility = "hidden"; }}
                />
              ) : (
                <span className={styles.compareImage} data-transparent={pane.transparent ? "" : undefined}><span className={styles.compareEmpty}>Not drawn yet</span></span>
              )}
              <figcaption>{pane.label}{pane.key === "drawing" && record ? <span className={styles.compareVerdict} data-passed={record.passed}><HugeiconsIcon icon={record.passed ? Tick02Icon : Cancel01Icon} size={11} strokeWidth={2.2} />{frame.approvedAttempt === record.attempt ? "approved" : record.passed ? "passed" : "rejected"}</span> : null}</figcaption>
            </figure>
          ))}
        </div>
        <ImageViewerContent />
      </ImageViewer>

      {attempts.length > 1 || (canApprove && record && frame.approvedAttempt !== record.attempt) ? (
        <div className={styles.compareFoot} role="group" aria-label="Attempts">
          <span className={styles.compareFootLabel}>Attempt</span>
          {attempts.map((entry) => (
            <ToggleChip key={entry.attempt} size="xs" selected={attempt === entry.attempt} onClick={() => setChosen(entry.attempt)}>
              <HugeiconsIcon icon={entry.passed ? Tick02Icon : Cancel01Icon} size={12} strokeWidth={2} />
              {entry.attempt}
            </ToggleChip>
          ))}
          {canApprove && record && frame.approvedAttempt !== record.attempt ? (
            <Button type="button" size="sm" variant="outline" className={styles.compareUse} disabled={busy} onClick={() => onApprove(record.attempt)} title="Use this drawing for the frame, whatever the checks said.">
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={1.75} />
              {frame.approvedAttempt === null ? `Approve attempt ${record.attempt}` : `Use attempt ${record.attempt} instead`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
