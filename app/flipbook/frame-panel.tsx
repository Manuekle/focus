"use client";

import { useRef, useState } from "react";
import { AiDrawingIcon, ArrowLeft01Icon, ArrowRight01Icon, PencilEdit02Icon, Refresh01Icon, Undo02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { ImageViewer, ImageViewerContent, ImageViewerThumbnail, type ImageViewerImage } from "../../components/motion/image-viewer";
import { useImageSizes } from "../../lib/hooks/use-image-sizes";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { FRAME_NOTE_LIMITS, IMAGE_ACCEPT_ATTRIBUTE, flipbookUrls, importedFromLabel, type Flipbook, type FlipbookFrame, type FrameAction } from "../../shared/flipbook";
import { messageFor } from "./flipbook-client";
import { PencilNote } from "../rotoscope/pencil-note";
import { frameThumb } from "./frame-strip";
import { FrameWorkingLarge, drawStage, ghostOf } from "./frame-working";
import { VersionTray } from "./version-tray";
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
  onCorrect,
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
  /** A pencil note: the red marks and what to change. */
  readonly onCorrect: (note: { comment: string; marks: Blob }) => void;
  readonly onMove: (delta: -1 | 1) => void;
  /** Cycle drawings can change places; a scene's beats can't. */
  readonly canMove?: boolean;
}) {
  const [view, setView] = useState<"sprite" | "raw">("sprite");
  const [note, setNote] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const [marking, setMarking] = useState(false);
  // An earlier drawing being looked at; it is not in the animation until "Use this drawing".
  const [looking, setLooking] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sprite = frameThumb(flipbook, frame);
  const raw = frame.version ? flipbookUrls.raw(flipbook.id, frame.id, frame.version) : null;
  const previewing = looking && looking !== frame.version && frame.versions.some((entry) => entry.id === looking) ? looking : null;
  const previewNumber = previewing ? frame.versions.findIndex((entry) => entry.id === previewing) + 1 : 0;
  const shown = previewing ? flipbookUrls.raw(flipbook.id, frame.id, previewing) : view === "raw" ? raw : sprite;
  const asRaw = Boolean(previewing) || view === "raw";
  const sizeOf = useImageSizes(shown ? [shown] : []);
  const label = previewing ? `${frame.label}, earlier drawing ${previewNumber}` : `${frame.label}, ${view === "raw" ? "drawing as generated" : "aligned sprite"}`;
  const picture: ImageViewerImage = { id: "frame", src: shown ?? "", alt: label, caption: `Frame ${index + 1} · ${frame.label} · ${previewing ? `drawing ${previewNumber}` : view === "raw" ? "as drawn" : "aligned sprite"}`, transparent: !asRaw, ...sizeOf(shown ?? "") };
  const stage = drawStage(flipbook, frame);
  // The pencil marks the drawing as Muse Image made it, at its own pixels.
  const markSize = frame.metrics ? { width: frame.metrics.rawWidth, height: frame.metrics.rawHeight } : undefined;
  const pose = flipbook.plan?.poses[frame.poseIndex];
  const locked = frame.approved;
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

      {stage ? (
        <div className={styles.inspect}>
          <FrameWorkingLarge flipbook={flipbook} frame={frame} stage={stage} ghost={ghostOf(flipbook, sprite ?? raw)} />
        </div>
      ) : marking && raw ? (
        <PencilNote
          image={raw}
          busy={busy}
          size={markSize}
          maxComment={FRAME_NOTE_LIMITS.maxCommentLength}
          single
          hint="Muse Image redraws this frame keeping what you did not mark. It is one drawing; the old version stays in this frame’s history."
          onCancel={() => setMarking(false)}
          onSend={(note) => { setMarking(false); onCorrect({ comment: note.comment, marks: note.marks }); }}
        />
      ) : shown ? (
        <ImageViewer
          images={[picture]}
          label="Drawing"
          value={zoomed ? picture.id : null}
          onValueChange={(id) => setZoomed(id !== null)}
        >
          <ImageViewerThumbnail imageId={picture.id} className={`${styles.inspect} rounded-xl bg-transparent`} data-transparent={!asRaw || undefined} />
          <ImageViewerContent />
        </ImageViewer>
      ) : (
        <div className={styles.inspect}>
          <p className="text-xs text-muted-foreground">No drawing yet.</p>
        </div>
      )}
      {previewing ? (
        <div className={styles.controlRow}>
          <span className="text-xs text-muted-foreground">Drawing {previewNumber} of {frame.versions.length}, not in the animation.</span>
          <Button size="xs" variant="outline" disabled={locked || busy} onClick={() => { onAction({ action: "use", version: previewing }); setLooking(null); }}>Use this drawing</Button>
          <Button size="xs" variant="ghost" onClick={() => setLooking(null)}>Back to current</Button>
        </div>
      ) : !marking ? (
        <div className={styles.chips}>
          <ToggleChip size="xs" selected={view === "sprite"} onClick={() => setView("sprite")}>Aligned sprite</ToggleChip>
          <ToggleChip size="xs" selected={view === "raw"} onClick={() => setView("raw")} disabled={!raw}>As drawn</ToggleChip>
        </div>
      ) : null}
      {frame.versions.length > 1 ? <VersionTray flipbook={flipbook} frame={frame} shown={previewing ?? frame.version} onPick={(version) => setLooking(version === frame.version ? null : version)} /> : null}

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
          <Button size="sm" variant="outline" disabled={locked || busy || marking || Boolean(flipbook.importedFrom) || !flipbook.reference || !raw} onClick={() => setMarking(true)} title="Draw red marks on what is wrong and say what to change (1 drawing).">
            <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />Mark &amp; redraw
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
