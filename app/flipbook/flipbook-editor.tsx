"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AiPaintbrushIcon, Cancel01Icon, PanelRightCloseIcon, PanelRightOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert, useDismissedNotices } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { MediaLightbox } from "../../components/ui/media-lightbox";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/toast-provider";
import {
  MAX_EXTRA_REFERENCES,
  actionSpec,
  backgroundMotion,
  type BackgroundMedia,
  flipbookUrls,
  flipbookTitle,
  importedFromLabel,
  importedFromUrl,
  orderedFrames,
  frameNeedsAttention,
  repairableFrames,
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
import { frameThumb } from "./frame-strip";
import { FrameWorking, STAGE_LABEL, drawStage, ghostOf } from "./frame-working";
import { InbetweenPanel } from "./inbetween-panel";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import composer from "../_editor/composer.module.css";
import { SequenceControls } from "./sequence-controls";
import { AudioPanel } from "./audio-panel";
import { DuplicatePanel } from "./duplicate-panel";
import { MotionReferencePanel } from "./motion-reference-panel";
import { ProgressSteps, ReferencePanel } from "./reference-panel";
import { SequencePlayer, type PlayerBackground, type PlayerFrame } from "./sequence-player";
import styles from "./flipbook.module.css";
import roto from "../rotoscope/rotoscope.module.css";
import { DockResizer, useDockWidth } from "../rotoscope/dock-resizer";
import { MediaImage } from "../../components/ui/media-image";
import { ScrollArea } from "../../components/ui/scroll-area";

type Confirm = { readonly message: string; readonly run: () => Promise<Flipbook> };
type RequestFailure = { readonly message: string; readonly request: (confirmExtra: boolean) => Promise<Flipbook> };

type DockTab = "motion" | "frame" | "look" | "export" | "advanced";
const DOCK_LABEL: Readonly<Record<DockTab, string>> = { motion: "Motion", frame: "Frame", look: "Look", export: "Export", advanced: "Advanced" };

export function FlipbookEditor({ flipbook, onChange, onStartOver }: { readonly flipbook: Flipbook; readonly onChange: (flipbook: Flipbook) => void; readonly onStartOver: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const frames = useMemo(() => orderedFrames(flipbook), [flipbook]);
  const { isDismissed, dismiss } = useDismissedNotices(flipbook.id);
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
  const planSignature = JSON.stringify([plan?.mode, plan?.motionId, plan?.drawingFps, plan?.durationSeconds, plan?.motion]);
  const appliedSignature = useRef(planSignature);
  useEffect(() => {
    if (!plan || appliedSignature.current === planSignature) return;
    appliedSignature.current = planSignature;
    setSettings(flipbook.look?.settings ?? { drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion, aspect: "16:9", speed: 1 });
  }, [plan, planSignature, flipbook.look]);
  const sequenceFps = flipbook.sequence?.drawingFps;
  const sequenceSeconds = flipbook.sequence?.durationSeconds;
  useEffect(() => {
    if (sequenceFps && sequenceSeconds) setSettings((current) => ({ ...current, drawingFps: sequenceFps, durationSeconds: sequenceSeconds, motion: "in_place", cycleSeconds: undefined, smoothing: 0 }));
  }, [sequenceFps, sequenceSeconds]);
  useEffect(() => {
    if (!plan || planApplied.current) return;
    planApplied.current = true;
    setSettings((current) => ({ ...current, drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion }));
  }, [plan]);
  // A new in-between calculation sets the speed: playback takes its cycle length, once per calculation.
  const inbetweenPlanAt = flipbook.inbetweenPlan?.createdAt;
  const inbetweenCycle = flipbook.inbetweenPlan?.cycleSeconds;
  const appliedInbetweenPlan = useRef(inbetweenPlanAt);
  useEffect(() => {
    if (!inbetweenPlanAt || appliedInbetweenPlan.current === inbetweenPlanAt) return;
    appliedInbetweenPlan.current = inbetweenPlanAt;
    setSettings((current) => ({ ...current, cycleSeconds: inbetweenCycle }));
  }, [inbetweenPlanAt, inbetweenCycle]);
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
  const [requestError, setRequestError] = useState<RequestFailure | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const active = isActive(flipbook);
  const spec = actionSpec(flipbook.plan?.action);
  // Several characters drawn together: a fixed-length scene, not a cycle of eight.
  const scene = flipbook.cast.length > 0;
  const finite = Boolean(flipbook.sequence);
  const total = flipbook.frames.length;
  const locked = busy || active;
  const prepared = Boolean(flipbook.plan && flipbook.reference);
  const editingLocked = locked || !prepared || flipbook.status === "unsupported";
  const videoMotion = Boolean(flipbook.sequence && (flipbook.motionSource === "video" || flipbook.motionReference));
  const title = flipbookTitle(flipbook);
  const motionLabel = videoMotion ? "video movement" : finite ? "continuous sequence" : flipbook.plan ? spec.label : "animation";

  /** Runs one request; a budget refusal turns into an explicit confirmation. */
  const run = useCallback(async (request: (confirmExtra: boolean) => Promise<Flipbook>, confirmExtra = false): Promise<boolean> => {
    setBusy(true);
    setRequestError(null);
    try {
      onChange(await request(confirmExtra));
      setConfirm(null);
      return true;
    } catch (error) {
      if (error instanceof FlipbookApiError && error.code === "budget_reached" && !confirmExtra) {
        setConfirm({ message: error.message, run: () => request(true) });
      } else {
        setRequestError({ message: error instanceof Error ? error.message : "Try again.", request: (extra) => request(extra || confirmExtra) });
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  // While drawings are made the selection follows the one being drawn, like Rotoscope's canvas; picking a frame by hand stops it until the next run.
  const [following, setFollowing] = useState(true);
  // One inspector beside the preview, as in Rotoscope: the movement first, everything else a tab away.
  // Its width is dragged and remembered like Rotoscope's; it hides into the canvas and comes back from there.
  const [dockTab, setDockTab] = useState<DockTab>("motion");
  const dock = useDockWidth("focus.flipbook.dock.width");
  const [dockOpen, setDockOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 861px)").matches);
  const select = (index: number) => {
    setFollowing(false);
    setSelected(index);
    setSeekNonce((value) => value + 1);
    setDockTab("frame");
    setDockOpen(true);
  };
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setFollowing(true);
    wasActive.current = active;
  }, [active]);
  const drawingIndex = frames.findIndex((entry) => drawStage(flipbook, entry) === "drawing");
  useEffect(() => {
    if (active && following && drawingIndex >= 0) setSelected(drawingIndex);
  }, [active, following, drawingIndex]);

  const selectedIndex = Math.min(selected, Math.max(0, frames.length - 1));
  const frame = frames[selectedIndex];
  // The movement tab has the chat and the in-betweens; a scene has neither, so it opens on its drawings.
  const hasMotionTab = !(scene || flipbook.importedFrom) || !(scene || finite);
  const dockTabs: readonly DockTab[] = hasMotionTab ? ["motion", "frame", "look", "export", "advanced"] : ["frame", "look", "export", "advanced"];
  const shownTab: DockTab = dockTabs.includes(dockTab) ? dockTab : dockTabs[0];
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
  // A key drawing's state as the timeline shows it: drawn, waiting, being drawn or failed.
  const keyState = (id: string): Pick<PlayerFrame, "status" | "stateLabel" | "approved" | "flagged"> => {
    const entry = frames.find((candidate) => candidate.id === id);
    if (!entry) return {};
    const stage = drawStage(flipbook, entry);
    const status = stage ? "working" : entry.status === "failed" ? "failed" : entry.status === "ready" && frameThumb(flipbook, entry) ? "ready" : "pending";
    return { status, stateLabel: stage ? STAGE_LABEL[stage] : status === "ready" ? undefined : status === "failed" ? "failed" : "not drawn", approved: entry.approved, flagged: frameNeedsAttention(entry) };
  };
  const frameKey = cycle.map((drawing) => {
    const state = drawing.inbetween ? null : keyState(drawing.id);
    return `${drawing.id}:${drawingSrc(drawing) ?? ""}:${drawing.label}:${drawing.position ?? ""}:${state ? `${state.status}${state.stateLabel}${state.approved}${state.flagged}` : ""}`;
  }).join("|");
  const playerFrames = useMemo(
    () => cycle.map((drawing): PlayerFrame => ({ id: drawing.id, label: drawing.label, phase: drawing.phase, inbetween: drawing.inbetween, position: drawing.position, src: drawingSrc(drawing), ...(drawing.inbetween ? null : keyState(drawing.id)) })),
    // frameKey captures every value the list depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameKey],
  );
  const hasScene = flipbook.backgrounds.scene;
  const hasCustom = flipbook.backgrounds.custom;
  const generatedAt = flipbook.backgrounds.generated?.createdAt ?? null;
  const backgroundColor = background.kind === "color" ? background.color : null;
  const motion = backgroundMotion(background);
  const backgroundFit = "fit" in background ? background.fit : undefined;
  const playerBackground = useMemo<PlayerBackground>(() => {
    if (backgroundColor !== null) return { kind: "color", color: backgroundColor };
    if (background.kind === "custom" && hasCustom) return { kind: "image", src: flipbookUrls.background(flipbook.id, "custom", backgroundStamp), fit: backgroundFit };
    const which = background.kind === "scene" && hasScene ? "scene" : background.kind === "generated" && generatedAt ? "generated" : null;
    if (!which) return { kind: "transparent" };
    const stamp = which === "scene" ? backgroundStamp : generatedAt!;
    const url = (media: BackgroundMedia) => flipbookUrls.background(flipbook.id, media, stamp);
    if (motion === "parallax") return { kind: "parallax", far: url(`${which}-far`), near: url(`${which}-near`) };
    if (motion === "scroll") return { kind: "scroll", src: url(`${which}-loop`) };
    if (motion === "zoom") return { kind: "zoom", src: url(which), fit: backgroundFit };
    return { kind: "image", src: url(which), fit: backgroundFit };
  }, [backgroundColor, background.kind, backgroundFit, motion, hasScene, hasCustom, generatedAt, flipbook.id, backgroundStamp]);

  // Keep what was picked with the animation, so it reopens the same way. Quietly: a missed save costs nothing.
  const lookKey = JSON.stringify({ settings, background });
  const savedLook = useRef(lookKey);
  useEffect(() => {
    if (!prepared || flipbook.status === "unsupported" || savedLook.current === lookKey) return;
    const timer = window.setTimeout(() => {
      savedLook.current = lookKey;
      void flipbookApi.action(flipbook.id, { action: "look", settings, background }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
    // lookKey captures settings and background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, flipbook.id, prepared, flipbook.status]);

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

  // A key drawing's picture on the timeline: the drawing itself, or the work in progress over its ghost.
  const clipThumb = (drawing: PlayerFrame) => {
    const entry = frames.find((candidate) => candidate.id === drawing.id);
    if (!entry) return null;
    const thumb = frameThumb(flipbook, entry);
    const stage = drawStage(flipbook, entry);
    if (stage) return <FrameWorking flipbook={flipbook} frame={entry} stage={stage} ghost={ghostOf(flipbook, thumb ? `${thumb}&thumb=1` : null)} />;
    return thumb ? <MediaImage src={`${thumb}&thumb=1`} alt="" draggable={false} loading="lazy" decoding="async" /> : null;
  };

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
  const flagged = frames.filter(frameNeedsAttention);
  const repairable = repairableFrames(flipbook);
  const approvedFlagged = flagged.filter((entry) => entry.approved).length;
  const rejectedVideo = flipbook.status === "unsupported" && videoMotion && flipbook.motionReference && flipbook.analysis && flipbook.analysis.characterCount > 0;
  const canRetryPreparation = !scene && !flipbook.reference && (flipbook.status === "failed" || flipbook.status === "canceled" || rejectedVideo);

  // One notice at a time, most urgent first. Informational ones can be closed, and the next one in line takes their place.
  const terminal = flipbook.status === "unsupported" || (flipbook.status === "failed" && !flipbook.reference) || flipbook.status === "canceled";
  const reviewKey = `review:${flipbook.review?.summary ?? ""}`;
  const noticeKind = confirm ? "confirm"
    : requestError ? "request"
      : terminal ? (flipbook.status === "canceled" && isDismissed("canceled") ? null : "status")
        : flipbook.error && !active ? "error"
          : flagged.length > 0 && !active ? "flagged"
            : flipbook.review && !active && !isDismissed(reviewKey) ? "review"
              : null;

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <div className="min-w-0">
          <p className={styles.sectionLabel}>Flipbook · {motionLabel}</p>
          <h1 className={styles.editorTitle} title={title}>{title}</h1>
          {scene ? <p className="mt-2 text-xs text-muted-foreground">{flipbook.cast.map((member, position) => <span key={`${member.characterId}:${member.versionId}`}>{position ? " · " : ""}<Link href={`/characters?c=${member.characterId}`} className="text-primary hover:underline">{member.name}</Link></span>)}<span className="ml-2">{flipbook.plan?.durationSeconds ?? "—"} s · {total} drawings</span></p> : flipbook.characterSource ? <p className="mt-2 text-xs text-muted-foreground"><Link href={`/characters?c=${flipbook.characterSource.characterId}`} className="text-primary hover:underline">{flipbook.characterSource.name}</Link> · {flipbook.characterSource.versionName}<span className="ml-2">Saved character version</span></p> : null}
          {flipbook.importedFrom ? <p className="mt-1 text-xs text-muted-foreground">Made in <Link href={importedFromUrl(flipbook.importedFrom)} className="text-primary hover:underline">{flipbook.importedFrom.kind === "rotoscope" ? "a Rotoscope run" : "a Motion render"}</Link>{flipbook.importedFrom.kind === "rotoscope" ? ": go back to redraw or approve more frames." : ": go back to render it again."}</p> : null}
        </div>
        <div className={styles.headActions}>
          <Badge title="Muse Image drawings used by this animation">Drawings {flipbook.budget.used}/{flipbook.budget.limit}</Badge>
          {readyCount >= 1 ? (
            <Button size="sm" variant="ghost" onClick={() => setSheetOpen(true)}>Contact sheet</Button>
          ) : null}
          {readyCount >= 2 ? (
            <Button size="sm" variant="outline" disabled={locked || reviewing} onClick={() => void review()} title={finite ? `Muse Spark reviews ${Math.ceil(readyCount / 16)} contact-sheet pages (${Math.ceil(readyCount / 16)} AI calls).` : "Muse Spark compares the contact sheet with the reference (1 AI call)."}>
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
          {!following && drawingIndex >= 0 ? <Button size="xs" variant="outline" className="w-fit" onClick={() => setFollowing(true)}>Follow the drawing</Button> : null}
        </div>
      ) : null}

      {noticeKind === "confirm" && confirm ? (
        <Alert tone="warning" title="Drawing budget reached" action={
          <div className={styles.buttonRow}>
            <Button size="sm" disabled={locked} onClick={() => { const pending = confirm; setConfirm(null); void run(() => pending.run(), true); }}>Draw anyway</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Not now</Button>
          </div>
        }>{confirm.message} Each drawing is one paid Muse Image request.</Alert>
      ) : null}

      {noticeKind === "request" && requestError ? (
        <Alert tone="error" role="alert" title="The change couldn’t be completed" onDismiss={() => setRequestError(null)} action={<Button size="sm" variant="outline" disabled={locked} onClick={() => { void run(requestError.request); }}>Try again</Button>}>
          {requestError.message}
        </Alert>
      ) : null}

      {noticeKind === "status" ? (
        <Alert tone={flipbook.status === "canceled" ? "info" : "error"} role={flipbook.status === "canceled" ? "status" : "alert"} onDismiss={flipbook.status === "canceled" ? () => dismiss("canceled") : undefined} title={flipbook.status === "unsupported" ? "This animation isn’t supported yet" : flipbook.status === "canceled" ? "Canceled" : "This animation couldn’t be made"} action={<>
          {canRetryPreparation ? <Button size="sm" disabled={locked} onClick={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "retry", confirmExtra }))}>Retry preparation</Button> : null}
          <Button size="sm" variant="outline" onClick={onStartOver}>Start over</Button>
        </>}>
          {flipbook.error ? messageFor(flipbook.error.code, flipbook.error.message) : "Start again with another illustration or instruction."}
        </Alert>
      ) : noticeKind === "error" && flipbook.error ? (
        <Alert tone="error" role="alert" size="sm">{messageFor(flipbook.error.code, flipbook.error.message)}</Alert>
      ) : null}

      {noticeKind === "flagged" ? (
        <Alert tone="warning" title={`${flagged.length} ${flagged.length === 1 ? "drawing needs" : "drawings need"} attention`} action={repairable.length && !flipbook.importedFrom ? <Button size="sm" variant="ai" disabled={locked || !flipbook.plan || !flipbook.reference} onClick={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "enhance_flagged", confirmExtra }))}>Fix all {repairable.length} {repairable.length === 1 ? "drawing" : "drawings"}</Button> : undefined}>
          {flipbook.importedFrom ? `These frames came from ${importedFromLabel(flipbook.importedFrom)}. Select a marked frame to review its warnings or replace it with your own drawing${flipbook.importedFrom.kind === "reference-motion" ? ", or render the motion again" : ""}.` : repairable.length ? `AI will use each drawing’s warnings to fix it while keeping its pose. This uses ${repairable.length} new ${repairable.length === 1 ? "drawing" : "drawings"}; previous versions stay in history.` : "Select a marked drawing to review its warnings or retry it."}
          {approvedFlagged ? ` ${approvedFlagged} approved ${approvedFlagged === 1 ? "drawing stays" : "drawings stay"} unchanged. Unapprove ${approvedFlagged === 1 ? "it" : "them"} to include ${approvedFlagged === 1 ? "it" : "them"} in a fix.` : ""}
          {flagged.some((entry) => entry.status === "failed") ? " Use Generate missing drawings to retry failed drawings." : ""}
          {flagged.some((entry) => entry.warnings.some((warning) => warning.code === "exposure_too_long")) ? " For long exposures, add in-between drawings or create a continuous sequence at 8 or more drawings/s; redrawing alone does not change the timing." : ""}
        </Alert>
      ) : null}

      {noticeKind === "review" && flipbook.review ? (
        <Alert tone={flipbook.review.recognizableWalk ? "info" : "warning"} size="sm" onDismiss={() => dismiss(reviewKey)} title={videoMotion ? `AI review: ${flipbook.review.recognizableWalk ? "movement looks coherent" : "movement needs review"}` : `AI review: ${flipbook.review.recognizableWalk ? "reads as" : "may not read as"} a ${spec.label}`}>
          {flipbook.review.summary} This is Muse Spark’s opinion; trust your eyes on the preview.
        </Alert>
      ) : null}

      <SequencePlayer
        key={`${flipbook.id}:${finite}:${sequenceFps}:${sequenceSeconds}`}
        frames={playerFrames}
        cell={cell}
        settings={settings}
        onSettingsChange={setSettings}
        background={playerBackground}
        selectedIndex={selectedIndex}
        seekNonce={seekNonce}
        strideMeasured={flipbook.alignment?.strideMeasured ?? false}
        travel={!finite && spec.travels ? { verb: spec.action === "run" ? "Run" : "Walk" } : null}
        facing={flipbook.plan?.direction ?? "right"}
        onSelect={setSelected}
        onPick={select}
        onMove={scene || finite || editingLocked ? undefined : move}
        clipThumb={clipThumb}
        inbetweenCount={inbetweenCount}
        fixedPace={scene || finite}
        finite={finite}
        audio={flipbook.audio ?? undefined}
        audioUrl={flipbook.audio ? `/api/flipbooks/${flipbook.id}/audio?v=${flipbook.audio.version}` : undefined}
        layout={({ stage, timeline, controls }) => (
          <div className={styles.workspace}>
            {/* Rotoscope's arrangement: the preview fills the room, the inspector docks on the right, resizable and hideable. */}
            <div className={styles.canvasRow} data-dock={dockOpen} style={dock.style}>
              <div className={styles.canvasCol}>
                {flipbook.plan && flipbook.reference && missing > 0 && !active ? (
                  <div className={styles.canvasCta}>
                    <p className="text-xs text-muted-foreground">{missing === total ? `The reference is ready. Next: ${total} drawings, one per ${scene ? "beat" : "pose"}.` : `${missing} of ${total} frames have no drawing.`}</p>
                    <Button size="sm" variant="ai" disabled={editingLocked} onClick={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "generate", confirmExtra }))}>
                      {missing === total ? `Generate ${total} frames` : `Draw ${missing} missing ${missing === 1 ? "frame" : "frames"}`}
                    </Button>
                  </div>
                ) : null}
                {stage}
                {/* The inspector closes from its own header; the canvas only offers to bring it back. */}
                {dockOpen ? null : (
                  <Button size="icon-sm" variant="outline" className={styles.dockShow} aria-label="Show inspector" onClick={() => setDockOpen(true)}>
                    <HugeiconsIcon icon={PanelRightOpenIcon} size={15} strokeWidth={1.75} />
                  </Button>
                )}
              </div>

              {dockOpen ? <DockResizer dock={dock} /> : null}
              <aside className={roto.dock} data-open={dockOpen} aria-label="Animation inspector">
                <div className={roto.dockInner}>
                  <div className={roto.dockHead}>
                    <SlidingTabs
                      className={`${composer.tabs} ${roto.dockTabs} ${styles.dockTabs}`}
                      tabs={dockTabs.map((id) => ({ id, label: DOCK_LABEL[id] }))}
                      value={shownTab}
                      onValueChange={(id) => setDockTab(id as DockTab)}
                    />
                    <Button size="icon-xs" variant="ghost" aria-label="Hide inspector" onClick={() => setDockOpen(false)}>
                      <HugeiconsIcon icon={PanelRightCloseIcon} size={15} strokeWidth={1.75} />
                    </Button>
                  </div>
                  <ScrollArea className={roto.dockScroll} viewportClassName={roto.dockViewport} contentClassName={roto.dockContent}>
                    {/* Keyed by what it shows, so a new tab or frame eases in instead of replacing the old one on the spot. */}
                    <div key={shownTab === "frame" ? `frame-${frame?.id ?? "none"}` : shownTab} className={styles.dockSwap}>
                  {shownTab === "motion" ? (
                    <>
                    {scene || flipbook.importedFrom ? null : <ChatPanel
                      flipbook={flipbook}
                      settings={settings}
                      busy={editingLocked}
                      onPlayback={applyPlayback}
                      onApplyPoses={(changes, confirmExtra, proposalId) => run((extra) => flipbookApi.applyChat(flipbook.id, { ...(proposalId ? { proposalId } : { changes: changes.map((change) => ({ frame: change.frame as FrameId, description: change.description })) }), confirmExtra: extra }), confirmExtra)}
                    />}
                    {scene || finite ? null : <InbetweenPanel
                      flipbook={flipbook}
                      drawingFps={flipbook.plan?.drawingFps ?? settings.drawingFps}
                      cycleSeconds={settings.cycleSeconds}
                      keysReady={notReady.length === 0}
                      disabled={editingLocked}
                      onPlan={() => void run(() => flipbookApi.action(flipbook.id, { action: "plan_inbetweens" }))}
                      onDrawPlanned={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "inbetweens", planned: true, confirmExtra }))}
                      onDraw={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "inbetweens", drawingFps: flipbook.plan?.drawingFps ?? settings.drawingFps, confirmExtra }))}
                      onCheckMotion={() => void run(() => flipbookApi.action(flipbook.id, { action: "check_motion" }))}
                      onFixMotion={() => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "fix_motion", confirmExtra }))}
                    />}
                    </>
                  ) : shownTab === "frame" ? (
                    <>
                    {frame ? (
                      <FramePanel
                        key={frame.id}
                        flipbook={flipbook}
                        frame={frame}
                        index={selectedIndex}
                        count={frames.length}
                        busy={editingLocked}
                        onAction={onFrameAction}
                        onReplace={(file) => void run(() => flipbookApi.replaceFrame(flipbook.id, frame.id, file))}
                        onCorrect={(note) => void run((confirmExtra) => flipbookApi.correctFrame(flipbook.id, frame.id, { ...note, confirmExtra }))}
                        onMove={(delta) => move(selectedIndex, selectedIndex + delta)}
                        canMove={!scene && !finite}
                      />
                    ) : null}
                      {frame ? null : <p className={styles.hint}>Select a drawing on the timeline to redraw, improve or replace it.</p>}
                    </>
                  ) : shownTab === "look" ? (
                    <>
                    <BackgroundPanel
                      flipbook={flipbook}
                      background={background}
                      onBackgroundChange={setBackground}
                      busy={editingLocked}
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
                    <AudioPanel key={flipbook.audio?.version ?? "no-audio"} flipbook={flipbook} disabled={editingLocked} onUpload={(file) => void run(() => flipbookApi.uploadAudio(flipbook.id, file))} onSave={(settings) => void run(() => flipbookApi.audioSettings(flipbook.id, settings))} onRemove={() => void run(() => flipbookApi.removeAudio(flipbook.id))} />
                    </>
                  ) : shownTab === "export" ? (
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
                  ) : (
                    <>
                      <p className={styles.hint}>Manual controls. Nothing here asks Muse Spark to decide for you.</p>
                    {controls}
                    <ReferencePanel
                      flipbook={flipbook}
                      busy={editingLocked}
                      onReference={(kind) => void run((confirmExtra) => flipbookApi.action(flipbook.id, { action: "reference", kind, confirmExtra }))}
                      onUploadReferences={(files, asAnchor) => void uploadReferences(files, asAnchor)}
                      onRemoveReference={(version) => void run(() => flipbookApi.removeReference(flipbook.id, version))}
                    />
                    {!scene && !flipbook.importedFrom ? <SequenceControls key={JSON.stringify(flipbook.sequence)} flipbook={flipbook} disabled={editingLocked} onPlan={(settings) => void run(() => flipbookApi.action(flipbook.id, { action: "sequence", settings }))} onRestore={(id) => void run(() => flipbookApi.action(flipbook.id, { action: "revision", id }))} /> : null}
                    {!scene && !flipbook.importedFrom ? <MotionReferencePanel key={flipbook.motionDraft?.version ?? flipbook.motionReference?.version ?? "no-motion"} flipbook={flipbook} disabled={locked || (!prepared && !videoMotion)} onUpload={(file) => void run(() => flipbookApi.uploadMotion(flipbook.id, file))} onAttach={(input) => void run(() => flipbookApi.attachMotion(flipbook.id, input))} /> : null}
                    {!scene && !flipbook.importedFrom ? <DuplicatePanel flipbook={flipbook} disabled={editingLocked} onCreated={(copy) => router.push(`/flipbook?f=${copy.id}`)} /> : null}
                    </>
                  )}
                    </div>
                  </ScrollArea>
                </div>
              </aside>
            </div>
            {timeline}
          </div>
        )}
      />

      <MediaLightbox
        items={Array.from({ length: finite ? Math.ceil(total / 16) : 1 }, (_, page) => ({ kind: "image" as const, src: `${flipbookUrls.contactSheet(flipbook.id, flipbook.updatedAt)}&page=${page}`, alt: finite ? `Drawings ${page * 16 + 1} to ${Math.min(total, page * 16 + 16)}` : "Contact sheet: every drawing in playback order", caption: finite ? `Contact sheet · ${page + 1} of ${Math.ceil(total / 16)}` : "Contact sheet · every drawing in playback order", transparent: true }))}
        index={sheetOpen ? finite ? Math.floor(Math.min(selected, total - 1) / 16) : 0 : null}
        onIndexChange={(page) => select(page * 16)}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
