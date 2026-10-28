"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AiPaintbrushIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { MediaLightbox } from "../../components/ui/media-lightbox";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/toast-provider";
import {
  MAX_EXTRA_REFERENCES,
  actionSpec,
  backgroundMotion,
  type BackgroundMedia,
  flipbookUrls,
  orderedFrames,
  playbackCycle,
  type ExportFormat,
  type Flipbook,
  type FlipbookBackground,
  type FrameAction,
  type FrameId,
  type PlaybackSettings,
} from "../../shared/flipbook";
import { applyPlaybackPatch, type PlaybackPatch } from "../../shared/flipbook-chat";
import { BackgroundPanel } from "./background-panel";
import { ChatPanel } from "./chat-panel";
import { ExportPanel, backgroundAllowed } from "./export-panel";
import { FlipbookApiError, flipbookApi, isActive, messageFor } from "./flipbook-client";
import { FramePanel } from "./frame-panel";
import { FrameStrip, frameThumb } from "./frame-strip";
import { InbetweenPanel } from "./inbetween-panel";
import { ProgressSteps, ReferencePanel } from "./reference-panel";
import { SequencePlayer, type PlayerBackground } from "./sequence-player";
import styles from "./flipbook.module.css";

type Confirm = { readonly message: string; readonly run: () => Promise<Flipbook> };

export function FlipbookEditor({ flipbook, onChange, onStartOver }: { readonly flipbook: Flipbook; readonly onChange: (flipbook: Flipbook) => void; readonly onStartOver: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const frames = useMemo(() => orderedFrames(flipbook), [flipbook]);
  const [selected, setSelected] = useState(0);
  const [seekNonce, setSeekNonce] = useState(0);
  // A saved animation reopens with the settings and background it was left with.
  const [settings, setSettings] = useState<PlaybackSettings>(() => flipbook.look?.settings ?? {
    drawingFps: flipbook.plan?.drawingFps ?? 8,
    durationSeconds: flipbook.plan?.durationSeconds ?? 4,
    motion: flipbook.plan?.motion ?? "in_place",
    aspect: "16:9",
    speed: 1,
  });
  // The plan arrives after the editor opens: its timing becomes the starting settings, once.
  const planApplied = useRef(Boolean(flipbook.plan || flipbook.look));
  const plan = flipbook.plan;
  useEffect(() => {
    if (!plan || planApplied.current) return;
    planApplied.current = true;
    setSettings((current) => ({ ...current, drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion }));
  }, [plan]);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [background, setBackground] = useState<FlipbookBackground>(() => flipbook.look?.background ?? { kind: "color", color: "#ffffff" });
  const [backgroundStamp, setBackgroundStamp] = useState("1");
  // A scene separated while the animation was being made becomes the background when it arrives, once.
  const sceneLook = flipbook.look?.background.kind === "scene" ? flipbook.look.background : null;
  const sceneAdopted = useRef(flipbook.look?.background.kind === "scene");
  useEffect(() => {
    if (!sceneLook || sceneAdopted.current) return;
    sceneAdopted.current = true;
    setBackground(sceneLook);
  }, [sceneLook]);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creatingScene, setCreatingScene] = useState(false);
  const [generatingBackground, setGeneratingBackground] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const active = isActive(flipbook);
  const spec = actionSpec(flipbook.plan?.action);
  // Several characters drawn together: a fixed-length scene, not a cycle of eight.
  const scene = flipbook.cast.length > 0;
  const total = flipbook.frames.length;
  const locked = busy || active;

  /** Runs one request; a budget refusal turns into an explicit confirmation. */
  const run = useCallback(async (request: (confirmExtra: boolean) => Promise<Flipbook>, confirmExtra = false): Promise<boolean> => {
    setBusy(true);
    try {
      onChange(await request(confirmExtra));
      setConfirm(null);
      return true;
    } catch (error) {
      if (error instanceof FlipbookApiError && error.code === "budget_reached" && !confirmExtra) {
        setConfirm({ message: error.message, run: () => request(true) });
      } else {
        toast({ title: "That didn’t work", description: error instanceof Error ? error.message : "Try again.", status: "error" });
      }
      return false;
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
  // The played cycle: the key drawings, with their current in-betweens unless they're switched off.
  const cycle = playbackCycle(flipbook, settings.inbetweens !== false);
  const inbetweenCount = playbackCycle(flipbook, true).filter((drawing) => drawing.inbetween).length;
  const drawingSrc = (drawing: (typeof cycle)[number]) => {
    if (!drawing.inbetween) return frameThumb(flipbook, frames.find((entry) => entry.id === drawing.id)!);
    const transform = flipbook.alignment?.transforms[drawing.id];
    return transform ? flipbookUrls.sprite(flipbook.id, drawing.id, transform.key) : null;
  };
  const frameKey = cycle.map((drawing) => `${drawing.id}:${drawingSrc(drawing) ?? ""}:${drawing.label}`).join("|");
  const playerFrames = useMemo(
    () => cycle.map((drawing) => ({ id: drawing.id, label: drawing.label, phase: drawing.phase, inbetween: drawing.inbetween, src: drawingSrc(drawing) })),
    // frameKey captures every value the list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameKey],
  );
  const hasScene = flipbook.backgrounds.scene;
  const hasCustom = flipbook.backgrounds.custom;
  const generatedAt = flipbook.backgrounds.generated?.createdAt ?? null;
  const backgroundColor = background.kind === "color" ? background.color : null;
  const motion = backgroundMotion(background);
  const playerBackground = useMemo<PlayerBackground>(() => {
    if (backgroundColor !== null) return { kind: "color", color: backgroundColor };
    if (background.kind === "custom" && hasCustom) return { kind: "image", src: flipbookUrls.background(flipbook.id, "custom", backgroundStamp) };
    const which = background.kind === "scene" && hasScene ? "scene" : background.kind === "generated" && generatedAt ? "generated" : null;
    if (!which) return { kind: "transparent" };
    const stamp = which === "scene" ? backgroundStamp : generatedAt!;
    const url = (media: BackgroundMedia) => flipbookUrls.background(flipbook.id, media, stamp);
    if (motion === "parallax") return { kind: "parallax", far: url(`${which}-far`), near: url(`${which}-near`) };
    if (motion === "scroll") return { kind: "scroll", src: url(`${which}-loop`) };
    if (motion === "zoom") return { kind: "zoom", src: url(which) };
    return { kind: "image", src: url(which) };
  }, [backgroundColor, background.kind, motion, hasScene, hasCustom, generatedAt, flipbook.id, backgroundStamp]);

  // Keep what was picked with the animation, so it reopens the same way. Quietly: a missed save costs nothing.
  const lookKey = JSON.stringify({ settings, background });
  const savedLook = useRef(lookKey);
  useEffect(() => {
    if (savedLook.current === lookKey) return;
    const timer = window.setTimeout(() => {
      savedLook.current = lookKey;
      void flipbookApi.action(flipbook.id, { action: "look", settings, background }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
    // lookKey captures settings and background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, flipbook.id]);

  const notReady = frames.filter((entry) => !frameThumb(flipbook, entry));
  const exportable = notReady.length
    ? { ok: false as const, reason: `Finish every frame first. Not ready: ${notReady.slice(0, 6).map((entry) => entry.label).join(", ")}${notReady.length > 6 ? ` and ${notReady.length - 6} more` : ""}.` }
    : active ? { ok: false as const, reason: "Wait for the current step to finish." } : { ok: true as const };

  const move = (from: number, to: number) => {
    const order = frames.map((entry) => entry.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void run(() => flipbookApi.action(flipbook.id, { action: "reorder", order }));
    setSelected(to);
    setSeekNonce((value) => value + 1);
  };

  const applyPlayback = (patch: PlaybackPatch) => setSettings((current) => applyPlaybackPatch(current, patch));

  const onFrameAction = (action: FrameAction) => {
    if (!frame) return;
    if (action.action === "regenerate" || action.action === "enhance") void run((confirmExtra) => flipbookApi.frame(flipbook.id, frame.id, { ...action, confirmExtra }));
    else void run(() => flipbookApi.frame(flipbook.id, frame.id, action));
  };

  /**
   * Several images at once. Extra views go first: they are quick, and the
   * anchor starts a worker that makes the flipbook busy until it is done.
   */
  const uploadReferences = async (files: File[], asAnchor: boolean) => {
    const anchor = asAnchor ? files[0] : undefined;
    const extras = (asAnchor ? files.slice(1) : files).slice(0, Math.max(0, MAX_EXTRA_REFERENCES - flipbook.extraReferences.length));
    const dropped = files.length - (anchor ? 1 : 0) - extras.length;
    setBusy(true);
    try {
      for (const file of extras) onChange(await flipbookApi.addReference(flipbook.id, file));
      if (anchor) onChange(await flipbookApi.uploadReference(flipbook.id, anchor));
      if (dropped > 0) toast({ title: "Some images were left out", description: `A character keeps up to ${MAX_EXTRA_REFERENCES} extra views. ${dropped} ${dropped === 1 ? "image was" : "images were"} not added.`, status: "info" });
    } catch (error) {
      toast({ title: "That didn’t work", description: error instanceof Error ? error.message : "Try again.", status: "error" });
    } finally {
      setBusy(false);
    }
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
      setBackground({ kind: "scene", motion: !spec.travels ? "zoom" : settings.motion === "in_place" ? (next.backgrounds.depth.scene ? "parallax" : "scroll") : "static" });
      setBackgroundStamp(String(Date.now()));
      return next;
    }).finally(() => setCreatingScene(false));
  };

  const generateBackground = (prompt: string) => {
    setGeneratingBackground(true);
    void run(async (confirmExtra) => {
      const next = await flipbookApi.action(flipbook.id, { action: "background", prompt: prompt || undefined, confirmExtra });
      // Sliding suits a walk or run in place, a slow zoom a pose that never travels (a wave), still one that already travels.
      setBackground({ kind: "generated", motion: background.kind === "generated" ? background.motion : !spec.travels ? "zoom" : settings.motion === "in_place" ? (next.backgrounds.depth.generated ? "parallax" : "scroll") : "static" });
      return next;
    }).finally(() => setGeneratingBackground(false));
  };

  const sendToEditor = async () => {
    setSending(true);
    try {
      const { video } = await flipbookApi.toEditor(flipbook.id, { settings, background: background.kind === "transparent" ? { kind: "color", color: "#ffffff" } : background });
      router.push(`/editor?v=${video.id}`);
    } catch (error) {
      toast({ title: "Couldn’t open it in the editor", description: error instanceof Error ? error.message : "Try again.", status: "error" });
      setSending(false);
    }
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
          {scene ? <p className="mt-2 text-xs text-muted-foreground">{flipbook.cast.map((member, position) => <span key={`${member.characterId}:${member.versionId}`}>{position ? " · " : ""}<Link href={`/characters?c=${member.characterId}`} className="text-primary hover:underline">{member.name}</Link></span>)}<span className="ml-2">{flipbook.plan?.durationSeconds ?? "—"} s · {total} drawings</span></p> : flipbook.characterSource ? <p className="mt-2 text-xs text-muted-foreground"><Link href={`/characters?c=${flipbook.characterSource.characterId}`} className="text-primary hover:underline">{flipbook.characterSource.name}</Link> · {flipbook.characterSource.versionName}<span className="ml-2">Saved character version</span></p> : null}
        </div>
        <div className={styles.headActions}>
          <span className={styles.pill} title="Muse Image drawings used by this animation">Drawings {flipbook.budget.used}/{flipbook.budget.limit}</span>
          {readyCount >= 1 ? (
            <Button size="sm" variant="ghost" onClick={() => setSheetOpen(true)}>Contact sheet</Button>
          ) : null}
          {readyCount >= 2 ? (
            <Button size="sm" variant="outline" disabled={locked || reviewing} onClick={() => void review()} title="Muse Spark compares the contact sheet with the reference (1 AI call).">
              {reviewing ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />}AI review
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
        <Alert tone={flipbook.review.recognizableWalk ? "info" : "warning"} size="sm" title={`AI review: ${flipbook.review.recognizableWalk ? "reads as" : "may not read as"} a ${spec.label}`}>
          {flipbook.review.summary} This is Muse Spark’s opinion; trust your eyes on the preview.
        </Alert>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.columnSide}>
          <ReferencePanel
            flipbook={flipbook}
            busy={locked}
            onReference={(kind) => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "reference", kind, confirmExtra }))}
            onUploadReferences={(files, asAnchor) => void uploadReferences(files, asAnchor)}
            onRemoveReference={(version) => void run(() => flipbookApi.removeReference(flipbook.id, version))}
          />
          {flipbook.plan && flipbook.reference && missing > 0 && !active ? (
            <div className={styles.cta}>
              <p className="text-xs text-muted-foreground">{missing === total ? `The reference is ready. Next: ${total} drawings, one per ${scene ? "beat" : "pose"}.` : `${missing} of ${total} frames have no drawing.`}</p>
              <Button className="w-full" variant="ai" disabled={locked} onClick={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "generate", confirmExtra }))}>
                {missing === total ? `Generate ${total} frames` : `Draw ${missing} missing ${missing === 1 ? "frame" : "frames"}`}
              </Button>
            </div>
          ) : null}
          <BackgroundPanel
            flipbook={flipbook}
            background={background}
            onBackgroundChange={setBackground}
            busy={locked}
            generating={generatingBackground}
            onGenerate={generateBackground}
            creatingScene={creatingScene}
            onCreateScene={createScene}
            stamp={backgroundStamp}
            onUploadReference={(file) => void run(() => flipbookApi.uploadBackgroundReference(flipbook.id, file))}
            onRemoveReference={() => void run(() => flipbookApi.removeBackgroundReference(flipbook.id))}
            onUploadBackground={(file) => void run(async () => {
              const next = await flipbookApi.uploadBackground(flipbook.id, file);
              setBackground({ kind: "custom" });
              setBackgroundStamp(String(Date.now()));
              return next;
            })}
          />
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
            facing={flipbook.plan?.direction ?? "right"}
            onSelect={setSelected}
            inbetweenCount={inbetweenCount}
            fixedPace={scene}
            strip={<FrameStrip flipbook={flipbook} frames={frames} selected={selected} onSelect={select} onMove={move} disabled={locked} scene={scene} />}
          />
          {scene ? null : <ChatPanel
            flipbook={flipbook}
            settings={settings}
            busy={locked}
            onPlayback={applyPlayback}
            onApplyPoses={(changes, confirmExtra) => run((extra) => flipbookApi.applyChat(flipbook.id, { changes: changes.map((change) => ({ frame: change.frame as FrameId, description: change.description })), confirmExtra: extra }), confirmExtra)}
          />}
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
              canMove={!scene}
            />
          ) : null}
          {scene ? null : <InbetweenPanel
            flipbook={flipbook}
            drawingFps={settings.drawingFps}
            keysReady={notReady.length === 0}
            disabled={locked}
            onDraw={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "inbetweens", confirmExtra }))}
          />}
          <ExportPanel
            flipbook={flipbook}
            settings={settings}
            onSettingsChange={setSettings}
            format={format}
            onFormatChange={setFormat}
            background={background}
            exportable={exportable}
            exporting={exporting}
            onExport={() => void exportNow()}
            sending={sending}
            onSendToEditor={() => void sendToEditor()}
          />
        </div>
      </div>

      <MediaLightbox
        items={[{ kind: "image", src: flipbookUrls.contactSheet(flipbook.id, flipbook.updatedAt), alt: "Contact sheet: every drawing in playback order", caption: "Contact sheet · every drawing in playback order", transparent: true }]}
        index={sheetOpen ? 0 : null}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
