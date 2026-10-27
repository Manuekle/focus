"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiMagicIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/toast-provider";
import {
  WALK_FRAME_COUNT,
  actionSpec,
  flipbookUrls,
  orderedFrames,
  type ExportFormat,
  type Flipbook,
  type FlipbookBackground,
  type FrameAction,
  type PlaybackSettings,
} from "../../shared/flipbook";
import { ExportPanel, backgroundAllowed } from "./export-panel";
import { FlipbookApiError, flipbookApi, isActive, messageFor } from "./flipbook-client";
import { FramePanel } from "./frame-panel";
import { FrameStrip, frameThumb } from "./frame-strip";
import { ProgressSteps, ReferencePanel } from "./reference-panel";
import { SequencePlayer, type PlayerBackground } from "./sequence-player";
import styles from "./flipbook.module.css";

type Confirm = { readonly message: string; readonly run: () => Promise<Flipbook> };

export function FlipbookEditor({ flipbook, onChange, onStartOver }: { readonly flipbook: Flipbook; readonly onChange: (flipbook: Flipbook) => void; readonly onStartOver: () => void }) {
  const { toast } = useToast();
  const frames = useMemo(() => orderedFrames(flipbook), [flipbook]);
  const [selected, setSelected] = useState(0);
  const [seekNonce, setSeekNonce] = useState(0);
  const [settings, setSettings] = useState<PlaybackSettings>(() => ({
    drawingFps: flipbook.plan?.drawingFps ?? 8,
    durationSeconds: flipbook.plan?.durationSeconds ?? 4,
    motion: flipbook.plan?.motion ?? "in_place",
    speed: 1,
  }));
  // The plan arrives after the editor opens: its timing becomes the starting settings, once.
  const planApplied = useRef(Boolean(flipbook.plan));
  const plan = flipbook.plan;
  useEffect(() => {
    if (!plan || planApplied.current) return;
    planApplied.current = true;
    setSettings((current) => ({ ...current, drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion }));
  }, [plan]);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [background, setBackground] = useState<FlipbookBackground>({ kind: "color", color: "#ffffff" });
  const [backgroundStamp, setBackgroundStamp] = useState("1");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const active = isActive(flipbook);
  const spec = actionSpec(flipbook.plan?.action);
  const locked = busy || active;

  /** Runs one request; a budget refusal turns into an explicit confirmation. */
  const run = useCallback(async (request: (confirmExtra: boolean) => Promise<Flipbook>, confirmExtra = false) => {
    setBusy(true);
    try {
      onChange(await request(confirmExtra));
      setConfirm(null);
    } catch (error) {
      if (error instanceof FlipbookApiError && error.code === "budget_reached" && !confirmExtra) {
        setConfirm({ message: error.message, run: () => request(true) });
      } else {
        toast({ title: "That didn’t work", description: error instanceof Error ? error.message : "Try again.", status: "error" });
      }
    } finally {
      setBusy(false);
    }
  }, [onChange, toast]);

  const select = (index: number) => {
    setSelected(index);
    setSeekNonce((value) => value + 1);
  };

  const frame = frames[Math.min(selected, frames.length - 1)];
  // Stable props for the player: new objects only when what they describe changes.
  const alignment = flipbook.alignment;
  const cellWidth = alignment?.cellWidth ?? 512;
  const cellHeight = alignment?.cellHeight ?? 768;
  const strideX = alignment?.strideX ?? 0;
  const cell = useMemo(() => ({ width: cellWidth, height: cellHeight, strideX }), [cellWidth, cellHeight, strideX]);
  const frameKey = frames.map((entry) => `${entry.id}:${frameThumb(flipbook, entry) ?? ""}:${entry.label}`).join("|");
  const playerFrames = useMemo(
    () => frames.map((entry) => ({ id: entry.id, label: entry.label, src: frameThumb(flipbook, entry) })),
    // frameKey captures every value the list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameKey],
  );
  const hasScene = flipbook.backgrounds.scene;
  const hasCustom = flipbook.backgrounds.custom;
  const backgroundColor = background.kind === "color" ? background.color : null;
  const playerBackground = useMemo<PlayerBackground>(() =>
    backgroundColor !== null ? { kind: "color", color: backgroundColor }
    : background.kind === "scene" && hasScene ? { kind: "image", src: flipbookUrls.background(flipbook.id, "scene", backgroundStamp) }
    : background.kind === "custom" && hasCustom ? { kind: "image", src: flipbookUrls.background(flipbook.id, "custom", backgroundStamp) }
    : { kind: "transparent" },
  [backgroundColor, background.kind, hasScene, hasCustom, flipbook.id, backgroundStamp]);

  const notReady = frames.filter((entry) => !frameThumb(flipbook, entry));
  const exportable = notReady.length
    ? { ok: false as const, reason: `Finish every frame first. Not ready: ${notReady.map((entry) => entry.label).join(", ")}.` }
    : active ? { ok: false as const, reason: "Wait for the current step to finish." } : { ok: true as const };

  const move = (from: number, to: number) => {
    const order = frames.map((entry) => entry.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void run(() => flipbookApi.action(flipbook.id, { action: "reorder", order }));
    setSelected(to);
    setSeekNonce((value) => value + 1);
  };

  const onFrameAction = (action: FrameAction) => {
    if (!frame) return;
    if (action.action === "regenerate") void run((confirmExtra) => flipbookApi.frame(flipbook.id, frame.id, { ...action, confirmExtra }));
    else void run(() => flipbookApi.frame(flipbook.id, frame.id, action));
  };

  const exportNow = async () => {
    if (!backgroundAllowed(format, background.kind)) return;
    setExporting(true);
    try {
      const { flipbook: next, record } = await flipbookApi.export(flipbook.id, { format, settings, background });
      onChange(next);
      toast({ title: "Export ready", description: `${record.facts.width}×${record.facts.height} · verified`, status: "success" });
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Try again.", status: "error" });
    } finally {
      setExporting(false);
    }
  };

  const createScene = () => {
    setCreatingScene(true);
    void run(async (confirmExtra) => {
      const next = await flipbookApi.action(flipbook.id, { action: "scene", confirmExtra });
      setBackground({ kind: "scene" });
      setBackgroundStamp(String(Date.now()));
      return next;
    }).finally(() => setCreatingScene(false));
  };

  const review = async () => {
    setReviewing(true);
    try {
      onChange(await flipbookApi.action(flipbook.id, { action: "review" }));
    } catch (error) {
      toast({ title: "Review failed", description: error instanceof Error ? error.message : "Try again.", status: "error" });
    } finally {
      setReviewing(false);
    }
  };

  const missing = flipbook.frames.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const readyCount = flipbook.frames.filter((entry) => entry.status === "ready").length;

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <div className="min-w-0">
          <p className={styles.sectionLabel}>Flipbook · {spec.label}</p>
          <h1 className={styles.editorTitle} title={flipbook.prompt}>“{flipbook.prompt}”</h1>
        </div>
        <div className={styles.headActions}>
          <span className={styles.pill} title="Muse Image drawings used by this animation">Drawings {flipbook.budget.used}/{flipbook.budget.limit}</span>
          {readyCount >= 1 ? (
            <Button asChild size="sm" variant="ghost">
              <a href={flipbookUrls.contactSheet(flipbook.id, flipbook.updatedAt)} target="_blank" rel="noreferrer">Contact sheet</a>
            </Button>
          ) : null}
          {readyCount >= 2 ? (
            <Button size="sm" variant="outline" disabled={locked || reviewing} onClick={() => void review()} title="Muse Spark compares the contact sheet with the reference (1 AI call).">
              {reviewing ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={AiMagicIcon} size={14} strokeWidth={1.75} />}AI review
            </Button>
          ) : null}
          {active ? (
            <Button size="sm" variant="ghost" onClick={() => void run(() => flipbookApi.action(flipbook.id, { action: "cancel" }))}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {active ? (
        <div className={styles.progress}>
          <ProgressSteps flipbook={flipbook} />
          {active && flipbook.detail ? <p className={styles.hint} role="status">{flipbook.detail}</p> : null}
        </div>
      ) : null}

      {confirm ? (
        <Alert tone="warning" title="Drawing budget reached" action={
          <div className={styles.buttonRow}>
            <Button size="sm" onClick={() => { const pending = confirm; setConfirm(null); void run(() => pending.run()); }}>Draw anyway</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Not now</Button>
          </div>
        }>{confirm.message} Each drawing is one paid Muse Image request.</Alert>
      ) : null}

      {flipbook.status === "unsupported" || (flipbook.status === "failed" && !flipbook.reference) || flipbook.status === "canceled" ? (
        <Alert tone={flipbook.status === "canceled" ? "info" : "error"} title={flipbook.status === "unsupported" ? "This animation isn’t supported yet" : flipbook.status === "canceled" ? "Canceled" : "This animation couldn’t be made"} action={<Button size="sm" variant="outline" onClick={onStartOver}>Start over</Button>}>
          {flipbook.error ? messageFor(flipbook.error.code, flipbook.error.message) : "Start again with another illustration or instruction."}
        </Alert>
      ) : flipbook.error && !active ? (
        <Alert tone="error" size="sm">{messageFor(flipbook.error.code, flipbook.error.message)}</Alert>
      ) : null}

      {flipbook.review && !active ? (
        <Alert tone={flipbook.review.recognizableWalk ? "info" : "warning"} size="sm" title={flipbook.review.recognizableWalk ? "AI review: reads as a walk" : "AI review: may not read as a walk"}>
          {flipbook.review.summary} This is Muse Spark’s opinion; trust your eyes on the preview.
        </Alert>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.columnSide}>
          <ReferencePanel
            flipbook={flipbook}
            busy={locked}
            onReference={(kind) => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "reference", kind, confirmExtra }))}
            onUploadReference={(file) => void run(() => flipbookApi.uploadReference(flipbook.id, file))}
          />
          {flipbook.plan && flipbook.reference && missing > 0 && !active ? (
            <div className={styles.cta}>
              <p className="text-xs text-muted-foreground">{missing === WALK_FRAME_COUNT ? "The reference is ready. Next: eight drawings, one per pose." : `${missing} of ${WALK_FRAME_COUNT} frames have no drawing.`}</p>
              <Button className="w-full" variant="ai" disabled={locked} onClick={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "generate", confirmExtra }))}>
                {missing === WALK_FRAME_COUNT ? `Generate ${WALK_FRAME_COUNT} frames` : `Draw ${missing} missing ${missing === 1 ? "frame" : "frames"}`}
              </Button>
            </div>
          ) : null}
        </div>

        <div className={styles.columnMain}>
          <SequencePlayer
            frames={playerFrames}
            cell={cell}
            settings={settings}
            onSettingsChange={setSettings}
            background={playerBackground}
            selectedIndex={Math.min(selected, Math.max(0, frames.length - 1))}
            seekNonce={seekNonce}
            strideMeasured={flipbook.alignment?.strideMeasured ?? false}
            travel={spec.travels ? { verb: spec.action === "run" ? "Run" : "Walk" } : null}
            onSelect={setSelected}
            strip={<FrameStrip flipbook={flipbook} frames={frames} selected={selected} onSelect={select} onMove={move} disabled={locked} />}
          />
        </div>

        <div className={styles.columnSide}>
          {frame ? (
            <FramePanel
              key={frame.id}
              flipbook={flipbook}
              frame={frame}
              index={selected}
              count={frames.length}
              busy={locked}
              onAction={onFrameAction}
              onReplace={(file) => void run(() => flipbookApi.replaceFrame(flipbook.id, frame.id, file))}
              onMove={(delta) => move(selected, selected + delta)}
            />
          ) : null}
          <ExportPanel
            flipbook={flipbook}
            settings={settings}
            onSettingsChange={setSettings}
            format={format}
            onFormatChange={(next) => {
              setFormat(next);
              if (!backgroundAllowed(next, background.kind)) setBackground(next === "mp4" ? { kind: "color", color: "#ffffff" } : { kind: "transparent" });
            }}
            background={background}
            onBackgroundChange={setBackground}
            exportable={exportable}
            exporting={exporting}
            onExport={() => void exportNow()}
            onCreateScene={createScene}
            creatingScene={creatingScene}
            onUploadBackground={(file) => void run(async () => {
              const next = await flipbookApi.uploadBackground(flipbook.id, file);
              setBackground(backgroundAllowed(format, "custom") ? { kind: "custom" } : background);
              setBackgroundStamp(String(Date.now()));
              return next;
            })}
          />
        </div>
      </div>
    </div>
  );
}
