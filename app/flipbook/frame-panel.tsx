"use client";

import { useRef, useState } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon, Refresh01Icon, Undo02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { IMAGE_ACCEPT_ATTRIBUTE, flipbookUrls, type Flipbook, type FlipbookFrame, type FrameAction } from "../../shared/flipbook";
import { messageFor } from "./flipbook-client";
import { frameThumb } from "./frame-strip";
import styles from "./flipbook.module.css";

const ISSUE_LABEL: Record<string, string> = {
  wrong_facing: "Facing the wrong way",
  identity_change: "Design changed",
  missing_limb: "Missing limb",
  extra_limb: "Extra limb",
  wrong_pose: "Pose doesn’t match",
  cropped: "Cropped",
  style_change: "Style changed",
  same_as_neighbor: "Same as a neighbor",
  other: "Other",
};

/** Everything about the selected drawing, and the few things that can be done to it. */
export function FramePanel({
  flipbook,
  frame,
  index,
  count,
  busy,
  onAction,
  onReplace,
  onMove,
}: {
  readonly flipbook: Flipbook;
  readonly frame: FlipbookFrame;
  readonly index: number;
  readonly count: number;
  readonly busy: boolean;
  readonly onAction: (action: FrameAction) => void;
  readonly onReplace: (file: File) => void;
  readonly onMove: (delta: -1 | 1) => void;
}) {
  const [view, setView] = useState<"sprite" | "raw">("sprite");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const sprite = frameThumb(flipbook, frame);
  const raw = frame.version ? flipbookUrls.raw(flipbook.id, frame.id, frame.version) : null;
  const shown = view === "raw" ? raw : sprite;
  const pose = flipbook.plan?.poses[frame.poseIndex];
  const locked = frame.approved;
  const working = frame.status === "generating" || frame.status === "processing";
  const canRestore = Boolean(frame.originalVersion && frame.originalVersion !== frame.version);
  const metrics = frame.metrics;

  return (
    <section className={styles.panel} aria-labelledby="frame-title">
      <div className={styles.panelHead}>
        <h2 id="frame-title" className={styles.panelTitle}>Frame {index + 1} · {frame.label}</h2>
        <label className={styles.inline}>
          <span className="text-xs text-muted-foreground">Approved</span>
          <Switch checked={frame.approved} disabled={frame.status !== "ready" && !frame.approved} onCheckedChange={(approved) => onAction({ action: "approve", approved })} label="Approve this frame" />
        </label>
      </div>

      <div className={styles.inspect} data-transparent={view === "sprite" || undefined}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- versioned media route
          <img src={shown} alt={`${frame.label}, ${view === "raw" ? "drawing as generated" : "aligned sprite"}`} />
        ) : (
          <p className="text-xs text-muted-foreground">{working ? "Working on this drawing…" : "No drawing yet."}</p>
        )}
      </div>
      <div className={styles.chips}>
        <ToggleChip size="xs" selected={view === "sprite"} onClick={() => setView("sprite")}>Aligned sprite</ToggleChip>
        <ToggleChip size="xs" selected={view === "raw"} onClick={() => setView("raw")} disabled={!raw}>As drawn</ToggleChip>
        {frame.versions.length > 1 ? <span className="text-xs text-muted-foreground">{frame.versions.length} versions</span> : null}
      </div>

      {frame.error ? <Alert tone="error" size="sm">{messageFor(frame.error.code, frame.error.message)}</Alert> : null}

      {frame.warnings.length || (frame.review && frame.review.issues.length) ? (
        <div className={styles.checks}>
          <p className={styles.sectionLabel}>Checks</p>
          <ul className={styles.checkList}>
            {frame.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
            {frame.review?.issues.map((issue, position) => (
              <li key={`${issue.code}-${position}`} data-source="review"><strong>{ISSUE_LABEL[issue.code] ?? issue.code}</strong> · {issue.note} <span className="text-muted-foreground">(AI review)</span></li>
            ))}
          </ul>
        </div>
      ) : frame.status === "ready" ? (
        <p className="text-xs text-muted-foreground">No automatic check flagged this frame. Automatic checks can’t confirm anatomy or identity; look at it in motion.</p>
      ) : null}

      {metrics ? (
        <dl className={styles.metrics}>
          <div><dt>Cut out by</dt><dd>{metrics.extraction === "sam" ? "SAM 3.1" : metrics.extraction === "alpha" ? "Your transparency" : "Background color"}</dd></div>
          <div><dt>Resized to match</dt><dd className="tabular-nums">{metrics.relativeScale >= 1 ? "+" : "−"}{Math.abs(Math.round((metrics.relativeScale - 1) * 100))}%</dd></div>
          <div><dt>Color drift</dt><dd className="tabular-nums">{metrics.colorDistance === null ? "—" : `${Math.round(metrics.colorDistance * 100)}%`}</dd></div>
        </dl>
      ) : null}

      {pose ? (
        <details className={styles.details}>
          <summary>Pose instructions</summary>
          <p>{pose.description}</p>
        </details>
      ) : null}

      <div className={styles.actions}>
        {locked ? <p className="text-xs text-muted-foreground">Approved frames are protected. Unapprove to change this one.</p> : null}
        <div className={styles.field}>
          <textarea
            className={styles.fieldInput}
            rows={2}
            maxLength={240}
            placeholder="What should change? (optional) e.g. “the back leg should be lifted”"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={locked || busy}
            aria-label="Correction note for the redraw"
          />
        </div>
        <div className={styles.buttonRow}>
          <Button size="sm" variant="ai" disabled={locked || busy || !flipbook.reference} onClick={() => { onAction({ action: "regenerate", note: note.trim() || undefined }); setNote(""); }}>
            <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />Redraw this frame
          </Button>
          <Button size="sm" variant="outline" disabled={locked || busy} onClick={() => fileRef.current?.click()}>
            <HugeiconsIcon icon={Upload01Icon} size={14} strokeWidth={1.75} />Replace
          </Button>
          {canRestore ? (
            <Button size="sm" variant="ghost" disabled={locked || busy} onClick={() => onAction({ action: "restore" })}>
              <HugeiconsIcon icon={Undo02Icon} size={14} strokeWidth={1.75} />Restore original
            </Button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onReplace(file);
            }}
          />
        </div>
        <div className={styles.buttonRow}>
          <Button size="xs" variant="ghost" disabled={busy || index === 0} onClick={() => onMove(-1)}><HugeiconsIcon icon={ArrowLeft01Icon} size={12} strokeWidth={1.75} />Move earlier</Button>
          <Button size="xs" variant="ghost" disabled={busy || index === count - 1} onClick={() => onMove(1)}>Move later<HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} /></Button>
        </div>
      </div>
    </section>
  );
}
