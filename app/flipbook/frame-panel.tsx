"use client";

import { useRef, useState } from "react";
import { AiDrawingIcon, ArrowLeft01Icon, ArrowRight01Icon, Refresh01Icon, Undo02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { MediaLightbox, ZoomButton } from "../../components/ui/media-lightbox";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { IMAGE_ACCEPT_ATTRIBUTE, flipbookUrls, importedFromLabel, type Flipbook, type FlipbookFrame, type FrameAction } from "../../shared/flipbook";
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
  canMove = true,
}: {
  readonly flipbook: Flipbook;
  readonly frame: FlipbookFrame;
  readonly index: number;
  readonly count: number;
  readonly busy: boolean;
  readonly onAction: (action: FrameAction) => void;
  readonly onReplace: (file: File) => void;
  readonly onMove: (delta: -1 | 1) => void;
  /** Cycle drawings can change places; a scene's beats can't. */
  readonly canMove?: boolean;
}) {
  const [view, setView] = useState<"sprite" | "raw">("sprite");
  const [note, setNote] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sprite = frameThumb(flipbook, frame);
  const raw = frame.version ? flipbookUrls.raw(flipbook.id, frame.id, frame.version) : null;
  const shown = view === "raw" ? raw : sprite;
  const pose = flipbook.plan?.poses[frame.poseIndex];
  const locked = frame.approved;
  const working = frame.status === "generating" || frame.status === "processing";
  const canRestore = Boolean(frame.originalVersion && frame.originalVersion !== frame.version);
  const metrics = frame.metrics;
  const flagged = frame.warnings.length + (frame.review?.issues.length ?? 0);
  const send = (action: "regenerate" | "enhance") => { onAction({ action, note: note.trim() || undefined }); setNote(""); };

  return (
    <section className={styles.panel} aria-labelledby="frame-title">
      <div className={styles.panelHead}>
        <h2 id="frame-title" className={styles.panelTitle}>Correct this drawing · {index + 1}{flipbook.sequence ? ` · ${(Number(frame.id.slice(1)) / 24).toFixed(2)} s` : ` · ${frame.label}`}</h2>
        <label className={styles.inline}>
          <span className="text-xs text-muted-foreground">Approved</span>
          <Switch checked={frame.approved} disabled={busy || (frame.status !== "ready" && !frame.approved)} onCheckedChange={(approved) => onAction({ action: "approve", approved })} label="Approve this frame" />
        </label>
      </div>

      {shown ? (
        <ZoomButton className={styles.inspect} data-transparent={view === "sprite" || undefined} label={`Open ${frame.label} larger`} onOpen={() => setZoomed(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- versioned media route */}
          <img src={shown} alt={`${frame.label}, ${view === "raw" ? "drawing as generated" : "aligned sprite"}`} />
        </ZoomButton>
      ) : (
        <div className={styles.inspect}>
          {working ? (
            <>
              <Skeleton className={styles.working} />
              <p className={styles.workingLabel}>{frame.status === "processing" ? "Cutting out this drawing…" : "Drawing this pose…"}</p>
            </>
          ) : <p className="text-xs text-muted-foreground">No drawing yet.</p>}
        </div>
      )}
      <MediaLightbox
        items={shown ? [{ kind: "image", src: shown, alt: `${frame.label}, ${view === "raw" ? "drawing as generated" : "aligned sprite"}`, caption: `Frame ${index + 1} · ${frame.label} · ${view === "raw" ? "as drawn" : "aligned sprite"}`, transparent: view === "sprite" }] : []}
        index={zoomed && shown ? 0 : null}
        onClose={() => setZoomed(false)}
      />
      <div className={styles.chips}>
        <ToggleChip size="xs" selected={view === "sprite"} onClick={() => setView("sprite")}>Aligned sprite</ToggleChip>
        <ToggleChip size="xs" selected={view === "raw"} onClick={() => setView("raw")} disabled={!raw}>As drawn</ToggleChip>
        {frame.versions.length > 1 ? <span className="text-xs text-muted-foreground">{frame.versions.length} versions</span> : null}
      </div>

      {frame.error ? <p className={styles.frameError} role="status">{messageFor(frame.error.code, frame.error.message)}</p> : null}

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
        <Disclosure title="Technical details">
        <dl className={styles.metrics}>
          <div><dt>Cut out by</dt><dd>{metrics.extraction === "sam" ? "SAM 3.1" : metrics.extraction === "alpha" ? "Your transparency" : "Background color"}</dd></div>
          <div><dt>Resized to match</dt><dd className="tabular-nums">{metrics.relativeScale >= 1 ? "+" : "−"}{Math.abs(Math.round((metrics.relativeScale - 1) * 100))}%</dd></div>
          <div><dt>Color drift</dt><dd className="tabular-nums">{metrics.colorDistance === null ? "—" : `${Math.round(metrics.colorDistance * 100)}%`}</dd></div>
        </dl>
        </Disclosure>
      ) : null}

      {pose ? (
        <Disclosure title="Pose instructions">
          <p className={styles.poseText}>{pose.description}</p>
        </Disclosure>
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
          <Button size="sm" variant="ai" disabled={locked || busy || Boolean(flipbook.importedFrom) || !flipbook.reference || !frame.version} onClick={() => send("enhance")} title={flagged ? `Muse Image repairs this drawing and fixes ${flagged === 1 ? "the problem" : `the ${flagged} problems`} found above (1 drawing).` : "Muse Image repairs this drawing: anatomy, identity and line work, same pose (1 drawing)."}>
            <HugeiconsIcon icon={AiDrawingIcon} size={14} strokeWidth={1.75} />Improve with AI
          </Button>
          <Button size="sm" variant="outline" disabled={locked || busy || Boolean(flipbook.importedFrom) || !flipbook.reference} onClick={() => send("regenerate")} title="Muse Image draws this pose again from the reference (1 drawing).">
            <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />Redraw
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
        {flipbook.importedFrom ? <p className={styles.hint}>This frame came from {importedFromLabel(flipbook.importedFrom)}. Replace it with your own drawing{flipbook.importedFrom.kind === "reference-motion" ? ", or render the motion again" : ""}.</p> : !locked && frame.version ? <p className={styles.hint}>Improve keeps this pose and fixes its mistakes. Redraw starts the pose over from the reference. Each is one drawing; the old version stays in this frame’s history.</p> : null}
        {canMove ? <div className={styles.buttonRow}>
          <Button size="xs" variant="ghost" disabled={busy || index === 0} onClick={() => onMove(-1)}><HugeiconsIcon icon={ArrowLeft01Icon} size={12} strokeWidth={1.75} />Move earlier</Button>
          <Button size="xs" variant="ghost" disabled={busy || index === count - 1} onClick={() => onMove(1)}>Move later<HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} /></Button>
        </div> : null}
      </div>
    </section>
  );
}
