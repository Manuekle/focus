"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AiPaintbrushIcon, AiSearch02Icon, ArrowLeftRightIcon, ArrowRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { GuidedSetup } from "./guided-setup";
import { guidedPrompt, guidedSequence } from "../../shared/flipbook-onboarding";
import { Skeleton } from "../../components/ui/skeleton";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { Switch } from "../../components/ui/switch";
import { FeatherSparkleColored24 } from "../../components/icons/FeatherSparkleColored24";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FileUpload } from "../../components/motion/file-upload";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Disclosure } from "../../components/ui/disclosure";
import { Spinner } from "../../components/ui/spinner";
import { formatBytes } from "../../shared/media";
import type { CharacterSource } from "../../shared/characters";
import { VIEW_OPTIONS, type ViewPreference } from "../../shared/animation-view";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  actionSpec,
  MAX_IMAGE_BYTES,
  hasAcceptedImageExtension,
  imageUrls,
  type CycleAction,
  type FlipbookImage,
  type ImageIdea,
  type ImageLook,
} from "../../shared/flipbook";
import { cn } from "../../lib/utils";
import { livingUrls } from "../../shared/living";
import { FlipbookApiError, flipbookApi, uploadCharacter, type UploadHandle } from "./flipbook-client";
import { Select } from "../../components/ui/select";
import { CharacterPicker } from "./character-picker";
import { handoffUrl } from "../characters/character-client";
import { referenceMotionEnabled, rotoscopeEnabled } from "../../shared/features";
import { SequenceFields } from "./sequence-controls";
import { MotionVideoInput, validMotionVideo, type MotionVideoSelection } from "./motion-video-input";
import { descriptionAnimationPrompt, videoAnimationPrompt } from "../../shared/animation-prompt";
import { DEFAULT_SEQUENCE, type SequenceSettings } from "../../shared/sequence";
import { LivingPanel, type LivingPreview } from "./living-panel";
import shell from "../editor/studio.module.css";
import composer from "../_editor/composer.module.css";
import upload from "../_editor/studio-upload.module.css";
import view from "../_editor/editor-view.module.css";
import styles from "./flipbook.module.css";

type Direction = "left" | "in_place" | "right";

/** Redraw the character in new poses, or keep the picture exactly as it is and move its own pixels. */
type Mode = "sequence" | "cycle" | "living";

/**
 * Following a video, three results: an editable Flipbook animation made
 * here, every frame copied exactly (Rotoscope) or a GPU render of the
 * movement (Motion). All three end in the Flipbook editor.
 */
type VideoResult = "editable" | "exact" | "motion";
const VIDEO_RESULTS = [
  { id: "editable", label: "Editable", note: "Flipbook plans keys and in-betweens from the video's movement: fast, and every drawing stays editable.", path: null, title: "", detail: "", cta: "" },
  ...(rotoscopeEnabled() ? [{ id: "exact", label: "Exact copy", note: "Rotoscope redraws every video frame with your character, checked frame by frame, then opens in Flipbook.", path: "/rotoscope", title: "Copy the video frame by frame", detail: "Rotoscope cuts the video into frames, redraws each one in the same pose and stops on any frame that fails its checks. Approve at least one second, then open it in Flipbook to edit and export.", cta: "Continue in Rotoscope" }] as const : []),
  ...(referenceMotionEnabled() ? [{ id: "motion", label: "Motion render", note: "Motion renders the character following the video on a GPU, then opens it in Flipbook.", path: "/animate", title: "Render the movement", detail: "Motion renders your character following the video on a GPU worker. Open the render in Flipbook to review, edit and export it.", cta: "Continue in Motion" }] as const : []),
] as const satisfies readonly { id: VideoResult; label: string; note: string; path: "/rotoscope" | "/animate" | null; title: string; detail: string; cta: string }[];

const MODES: readonly { id: Mode; label: string; note: string }[] = [
  { id: "sequence", label: "Continuous sequence", note: "Draw the whole action across your chosen duration, with a drawing for every moment." },
  { id: "cycle", label: "Redraw a cycle", note: "Focus redraws your character in eight new poses: a walk, a run, a jump. Best for a full-body drawing." },
  { id: "living", label: "Animate as is", note: "Nothing is redrawn: hair sways, leaves fly and the sky drifts, made only of your picture’s own pixels." },
];

const ACTIONS: readonly { action: CycleAction; label: string; note: string }[] = [
  { action: "walk", label: "Walk", note: "A relaxed stride with a natural up-and-down bob." },
  { action: "run", label: "Run", note: "Fast and leaning forward; both feet leave the ground mid-stride." },
  { action: "jump", label: "Jump", note: "Crouch, push off, tuck at the top, land and recover, on the spot." },
  { action: "fight", label: "Fight", note: "Shadowboxing in place: guard, a jab, a cross, back to guard." },
  { action: "wave", label: "Wave", note: "Raises a hand and waves hello, then lowers it again." },
  { action: "idle", label: "Idle", note: "Breathes, blinks and gently sways. Describe a posture, or keep the one in your drawing." },
  { action: "dance", label: "Dance", note: "Side steps, arm swings and a rhythmic bounce. Describe the style below." },
];

/** Walks and runs can travel; the other motions stay on the spot. */
const travels = (action: CycleAction) => actionSpec(action).travels;

const DIRECTIONS: readonly { id: Direction; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "in_place", label: "In place" },
  { id: "right", label: "Right" },
];

const DETAIL_MAX = 400;

export type CreateOptions = { readonly motionFile?: File; readonly motionTrim?: { start: number; durationSeconds: number; useAudio: boolean }; readonly motionSource?: "video"; readonly motionNote?: string; readonly sequence?: SequenceSettings; readonly action?: CycleAction; readonly keepScene?: boolean; readonly characterSource?: CharacterSource; readonly view?: ViewPreference };

const VIEW_LABEL: Record<ImageLook["analysis"]["view"], string> = { side: "Side view", three_quarter: "Three-quarter view", front: "Front view", back: "Back view", high: "View from above", low: "View from below", unclear: "View unclear" };

const VERB: Record<CycleAction, string> = { walk: "Walk", run: "Run", jump: "Jump", fight: "Shadowbox", wave: "Wave", idle: "Idle", dance: "Dance" };

/** "Run right · hair and tail flowing", "Wave facing left · shy" */
function ideaLabel(idea: ImageIdea): string {
  const where = idea.direction === "in_place" ? "in place" : travels(idea.action) ? idea.direction : `facing ${idea.direction}`;
  return `${VERB[idea.action]} ${where}${idea.detail ? ` · ${idea.detail}` : ""}`;
}

const PLACEHOLDER: Record<CycleAction, string> = {
  walk: "How does it walk? e.g. “cheerful, arms swinging wide”",
  run: "How does it run? e.g. “sprinting, hair flying back”",
  jump: "How does it jump? e.g. “a big joyful leap”",
  fight: "How does it fight? e.g. “quick and light on its feet”",
  wave: "How does it wave? e.g. “shy, a small wave”",
  idle: "How does it rest? e.g. “sitting calmly, slow breathing”",
  dance: "How does it dance? e.g. “side steps, arm swings and a gentle bounce”",
};

const IDEAS: Record<CycleAction, readonly string[]> = {
  walk: ["cheerful, arms swinging wide", "sneaking on tiptoe", "tired, dragging its feet"],
  run: ["sprinting at full speed", "a light jog", "running late, panicked"],
  jump: ["a big joyful leap", "a small excited hop", "a heavy, powerful jump"],
  fight: ["quick and light on its feet", "heavy, powerful punches", "a confident boxer"],
  wave: ["an excited, big wave", "shy, a small wave", "waving goodbye"],
  idle: ["sitting calmly, slow breathing", "crouching, looking around", "proud, chest out"],
  dance: ["side steps and flowing arm swings", "playful hip sways and a gentle bounce", "a relaxed, graceful dance"],
};

/** The instruction the pickers stand for; the analysis reads it like typed text. */
function instruction(action: CycleAction, direction: Direction, detail: string, facing: "left" | "right", view: ViewPreference, originalLateral: boolean): string {
  const side = direction === "in_place" ? facing : direction;
  const camera = view === "original" ? originalLateral ? `preserve the original camera view, facing ${side}` : "preserve the original camera view and facing direction" : view === "front" ? "front view, facing the camera" : view === "back" ? "back view, facing away from the camera" : view === "three_quarter" ? `three-quarter view facing ${side}` : view === "high" ? "high-angle view from above" : view === "low" ? "low-angle view from below" : `side profile facing ${side}`;
  const base =
    action === "fight" ? `Shadowbox: a jab and a cross, ${camera}`
    : action === "jump" ? `Jump in place, ${camera}`
    : action === "wave" ? `Wave hello, ${camera}`
    : action === "idle" ? `Rest in place, breathing and blinking, ${camera}`
    : action === "dance" ? `Dance in place, ${camera}`
    : direction === "in_place" ? `${action === "run" ? "Run" : "Walk"} in place, ${camera}`
    : `${action === "run" ? "Run" : "Walk"} across the screen to the ${direction}, ${camera}`;
  const extra = detail.trim().replace(/^[,.\s]+/, "");
  return extra ? `${base}, ${extra}` : base;
}

/**
 * Step one. Before an upload, only the drop, like the editor's empty state.
 * With a drawing, the video editor's own layout and controls: the drawing at
 * its real proportions on the left, and the composer on the right, with the
 * motion and direction picked in sliding tabs and the details typed.
 */
export function FlipbookCreate({
  onCreate,
  creating,
  blockedReason,
  initialCharacter,
}: {
  readonly onCreate: (image: FlipbookImage, prompt: string, options: CreateOptions) => void;
  readonly creating: boolean;
  readonly blockedReason?: string;
  readonly initialCharacter?: { readonly image: FlipbookImage; readonly source: CharacterSource; readonly name: string };
}) {
  const [image, setImage] = useState<FlipbookImage | null>(initialCharacter?.image ?? null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<CycleAction>("walk");
  const [cameraView, setCameraView] = useState<ViewPreference>("original");
  const [direction, setDirection] = useState<Direction>("right");
  const [detail, setDetail] = useState("");
  const [look, setLook] = useState<ImageLook | null>(null);
  const [lookFailed, setLookFailed] = useState(false);
  const [keepScene, setKeepScene] = useState(true);
  const [layer, setLayer] = useState<"original" | "character" | "scene">("original");
  const [mode, setMode] = useState<Mode>("sequence");
  /** Muse Spark sets the animation up from a conversation; Advanced keeps every control by hand. */
  const [guided, setGuided] = useState(true);
  const [sequence, setSequence] = useState<SequenceSettings>(DEFAULT_SEQUENCE);
  const [motionSource, setMotionSource] = useState<"description" | "video">("description");
  const [motionVideo, setMotionVideo] = useState<MotionVideoSelection>();
  const [videoDetail, setVideoDetail] = useState("");
  // Following a video: an editable Flipbook here, or another way of animating that ends in Flipbook too.
  const [videoResult, setVideoResult] = useState<VideoResult>("editable");
  const [living, setLiving] = useState<LivingPreview>({ video: null, busy: false, highlight: null });
  const touched = useRef(false);
  const handle = useRef<UploadHandle | null>(null);

  useEffect(() => () => handle.current?.abort(), []);

  // Once uploaded, Focus reads the drawing: what is in it, motions that suit
  // it, and its layers. Its first idea becomes the starting pick, unless the
  // person has already chosen.
  const imageId = image?.id;
  const fromCharacter = Boolean(initialCharacter && imageId === initialCharacter.image.id && image?.url === initialCharacter.image.url);
  useEffect(() => {
    if (!imageId) return;
    if (fromCharacter) { setLookFailed(true); return; }
    let canceled = false;
    setLook(null);
    setLookFailed(false);
    setLayer("original");
    setLiving({ video: null, busy: false, highlight: null });
    touched.current = false;
    flipbookApi.look(imageId).then(
      (next) => {
        if (canceled) return;
        setLook(next);
        setKeepScene(next.layers.scene);
        if (touched.current) return;
        const idea = next.ideas[0];
        if (idea) {
          setAction(idea.action);
          setDirection(travels(idea.action) && ["front", "back"].includes(next.analysis.view) ? "in_place" : idea.direction);
          setDetail(idea.detail);
        } else if (next.analysis.facing === "left" || next.analysis.facing === "right") {
          setDirection(next.analysis.facing);
        }
      },
      () => { if (!canceled) setLookFailed(true); },
    );
    return () => { canceled = true; };
  }, [imageId, fromCharacter]);

  const pickIdea = (idea: ImageIdea) => {
    touched.current = true;
    setAction(idea.action);
    setDirection(idea.direction);
    setDetail(idea.detail);
  };

  const start = (file: File) => {
    setError(null);
    if (!hasAcceptedImageExtension(file.name)) return setError("Upload a PNG, JPEG or WebP image.");
    if (file.size > MAX_IMAGE_BYTES) return setError(`This image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.`);
    handle.current?.abort();
    setProgress(0);
    setPending({ name: file.name, size: file.size });
    const next = uploadCharacter(file, setProgress);
    handle.current = next;
    next.promise.then(
      (uploaded) => { if (handle.current === next) { setImage(uploaded); setProgress(null); } },
      (failure) => {
        if (handle.current !== next) return;
        setProgress(null);
        if (failure instanceof FlipbookApiError && failure.code === "aborted") return;
        setError(failure instanceof Error ? failure.message : "We couldn’t upload your image.");
      },
    );
  };

  /** The side to face when a motion stays on the spot: the drawing's own, when it has one. */
  const facing = look?.analysis.facing === "left" ? "left" : "right";
  const lateralView = cameraView === "side" || cameraView === "three_quarter" || (cameraView === "original" && Boolean(look && ["side", "three_quarter"].includes(look.analysis.view)));
  const otherWay = mode === "sequence" && motionSource === "video" && videoResult !== "editable" ? VIDEO_RESULTS.find((entry) => entry.id === videoResult)! : null;
  const fromVideo = mode === "sequence" && motionSource === "video" && !otherWay;
  const sequenceSettings = { ...sequence, ...(fromVideo && motionVideo ? { durationSeconds: motionVideo.durationSeconds } : {}) };
  const motionInstruction = instruction(action, direction, detail, facing, cameraView, lateralView);
  const prompt = fromVideo ? videoAnimationPrompt({ settings: sequenceSettings, start: motionVideo?.start ?? 0, note: videoDetail }) : descriptionAnimationPrompt(motionInstruction, mode === "sequence" ? sequence : undefined);
  const canSubmit = Boolean(image) && !creating && !blockedReason && (!fromVideo || validMotionVideo(motionVideo));
  const submit = () => {
    if (!image || !canSubmit || mode === "living") return;
    // With a reading, the picked motion says which action it is, and its character facts are reused.
    onCreate(image, prompt, { ...(fromVideo ? { motionSource: "video", motionNote: videoDetail, motionFile: motionVideo!.file, motionTrim: { start: motionVideo!.start, durationSeconds: motionVideo!.durationSeconds, useAudio: motionVideo!.useAudio } } : { action, view: cameraView }), ...(mode === "sequence" ? { sequence: sequenceSettings } : {}), keepScene: Boolean(look?.layers.scene && keepScene), ...(fromCharacter ? { characterSource: initialCharacter!.source } : {}) });
  };
  const layerSrc = image && layer !== "original" && mode === "cycle" ? imageUrls.layer(image.id, layer) : image?.url;
  const shown = mode === "cycle" ? layer : "original";

  if (image) return (
    <div className={cn(view.editor, styles.createWorkspace)} data-variant="page">
      <h1 id="flipbook-title" className="sr-only">Make your drawing move</h1>
      <section aria-label="Drawing" className={cn(view.preview, styles.createPreview)}>
        <figure className={styles.drawingFigure}>
          <div className={styles.drawingStage} data-transparent={image.hasAlpha || shown !== "original" || undefined}>
            <div className={styles.mediaBox}>
              {/* A hovered layer is shown on the still picture: the video may be cropped or zoomed, its mask isn't. */}
              {mode === "living" && living.video && !living.highlight && !living.pick ? (
                // Muted so it can autoplay; with sound, the controls turn it on.
                <video key={living.video} src={living.video} width={image.width} height={image.height} autoPlay loop muted playsInline controls={living.hasAudio || undefined} aria-label="Your picture in motion" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- media route */
                <img
                  key={shown}
                  src={layerSrc}
                  alt={shown === "character" ? "Your character, cut out" : shown === "scene" ? "The scene with the character taken out" : "Your character illustration"}
                  width={image.width}
                  height={image.height}
                  className={shown === "character" ? styles.layerCharacter : undefined}
                  data-picking={mode === "living" && living.pick ? "" : undefined}
                  // Picking a part: the click, in the picture's own pixels.
                  onClick={mode === "living" && living.pick ? (event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    living.pick!(Math.floor(((event.clientX - box.left) / box.width) * image.width), Math.floor(((event.clientY - box.top) / box.height) * image.height));
                  } : undefined}
                />
              )}
              {mode === "living" && living.highlight ? (
                <span className={styles.layerHighlight} style={{ maskImage: `url(${livingUrls.mask(image.id, living.highlight)})`, WebkitMaskImage: `url(${livingUrls.mask(image.id, living.highlight)})` }} aria-hidden="true" />
              ) : null}
            </div>
            {(!fromCharacter && !look && !lookFailed) || (mode === "living" && living.busy) ? <Skeleton className={styles.readingSweep} /> : null}
          </div>
        </figure>
        {look?.layers.character && mode === "cycle" ? (
          <SlidingTabs
            className={cn(composer.tabs, styles.layerTabs)}
            tabs={[
              { id: "original", label: "Original" },
              { id: "character", label: "Character" },
              ...(look.layers.scene ? [{ id: "scene", label: "Scene" }] : []),
            ]}
            value={layer}
            onValueChange={(id) => setLayer(id as typeof layer)}
          />
        ) : null}
        <div className={view.fileRow}>
          <div className={view.fileDetails}>
            <p className={view.fileName} title={image.originalName}>{image.originalName}</p>
            <p className={view.fileMeta}>{image.width}×{image.height} · {image.hasAlpha ? "transparent" : "with background"}{pending ? ` · ${formatBytes(pending.size)}` : ""}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setImage(null)} aria-label="Change drawing">
            <HugeiconsIcon icon={ArrowLeftRightIcon} size={14} strokeWidth={1.5} />New drawing
          </Button>
        </div>
        <section className={styles.reading} aria-live="polite" aria-busy={!look && !lookFailed}>
          <span className={composer.groupLabel}><HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />{fromCharacter ? "From your characters" : look ? "In this drawing" : lookFailed ? "Pick a motion" : "Reading your drawing…"}</span>
          {fromCharacter ? <p className={styles.hint}>This version stays with the animation. Later designs won’t change it. <Link href={`/characters?c=${initialCharacter!.source.characterId}`} className="text-primary hover:underline">Back to {initialCharacter!.name}</Link></p> : look ? (
            <>
              {look.summary ? <p className={styles.readingSummary}>{look.summary}</p> : null}
              <div className={composer.chips}>
                <Badge size="sm">{look.analysis.subject}</Badge>
                {look.analysis.characterCount > 1 ? <Badge size="sm">{look.analysis.characterCount} characters · animates one</Badge> : null}
                <Badge size="sm">{VIEW_LABEL[look.analysis.view]}</Badge>
                <Badge size="sm">{look.setting || "No background"}</Badge>
              </div>
              {/* The caveats are about redrawing; animating as is redraws nothing. */}
              {look.warnings.length && mode !== "living" ? (
                <ul className={styles.readingNotes}>
                  {look.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : null}
            </>
          ) : lookFailed ? (
            <p className={styles.hint}>Focus couldn’t read this drawing right now. Pick a motion; it will look at the drawing when you create.</p>
          ) : (
            <div className={styles.readingSkeleton}>
              <Skeleton shape="text" style={{ width: "92%" }} />
              <Skeleton shape="text" style={{ width: "64%" }} delay={60} />
              <div className={composer.chips}>
                {[72, 96, 132].map((width, index) => <Skeleton key={width} shape="round" style={{ width, height: 24 }} delay={120 + index * 50} />)}
              </div>
            </div>
          )}
        </section>
      </section>

      <aside className={cn(view.controls, styles.createControls)}>
        <SlidingTabs className={composer.tabs} tabs={[{ id: "guided", label: "Guided" }, { id: "advanced", label: "Advanced" }]} value={guided ? "guided" : "advanced"} onValueChange={(id) => setGuided(id === "guided")} />
        {guided ? (
          <GuidedSetup
            picture={fromCharacter ? { characterSource: initialCharacter!.source } : { imageId: image.id }}
            look={look}
            creating={creating}
            blockedReason={blockedReason ?? null}
            onCreate={(setup) => onCreate(image, guidedPrompt(setup), {
              action: setup.action,
              view: setup.view,
              ...(guidedSequence(setup) ? { sequence: guidedSequence(setup) } : {}),
              keepScene: Boolean(look?.layers.scene && setup.keepScene),
              ...(fromCharacter ? { characterSource: initialCharacter!.source } : {}),
            })}
          />
        ) : <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <section className={styles.createCard} aria-labelledby="animation-setup-title">
            <h2 id="animation-setup-title" className={styles.panelTitle}>Animation setup</h2>
            <fieldset className={composer.effects}>
              <legend className="sr-only">How it moves</legend>
              <SlidingTabs className={composer.tabs} tabs={MODES.filter((entry) => !fromCharacter || entry.id !== "living").map((entry) => ({ id: entry.id, label: entry.label }))} value={mode} onValueChange={(id) => { touched.current = true; setMode(id as Mode); }} />
              <p className={composer.summary} aria-live="polite">{MODES.find((entry) => entry.id === mode)!.note}</p>
            </fieldset>

            {mode === "sequence" ? <>
              <fieldset className={composer.effects}>
                <legend className={composer.label}>Movement source</legend>
                <SlidingTabs className={composer.tabs} tabs={[{ id: "description", label: "Describe motion" }, { id: "video", label: "Guided by video" }]} value={motionSource} onValueChange={(id) => setMotionSource(id as typeof motionSource)} />
              </fieldset>
              {motionSource === "video" && VIDEO_RESULTS.length > 1 ? (
                <fieldset className={composer.effects}>
                  <legend className={composer.label}>What you get</legend>
                  <SlidingTabs className={composer.tabs} tabs={VIDEO_RESULTS.map((entry) => ({ id: entry.id, label: entry.label }))} value={videoResult} onValueChange={(id) => setVideoResult(id as VideoResult)} />
                  <p className={composer.summary} aria-live="polite">{VIDEO_RESULTS.find((entry) => entry.id === videoResult)!.note}</p>
                </fieldset>
              ) : null}
              {fromVideo ? <MotionVideoInput value={motionVideo} disabled={creating} onChange={setMotionVideo} /> : null}
              {otherWay ? null : <div className={fromVideo ? styles.controlField : styles.createTiming}><SequenceFields value={sequence} onChange={setSequence} disabled={creating} compact videoDuration={fromVideo ? motionVideo?.durationSeconds ?? sequence.durationSeconds : undefined} /></div>}
            </> : null}
          </section>
          {otherWay ? (
            <section className={styles.createCard} aria-labelledby="other-way-title">
              <h2 id="other-way-title" className={styles.panelTitle}>{otherWay.title}</h2>
              <p className={styles.hint}>{otherWay.detail}</p>
              <Button asChild variant="ai" className="w-full">
                <Link href={handoffUrl(otherWay.path!, fromCharacter ? { characterId: initialCharacter!.source.characterId, versionId: initialCharacter!.source.versionId } : image ? { imageUrl: image.url } : null)}>
                  {otherWay.cta}
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
                </Link>
              </Button>
              <p className={styles.hint}>{image ? "Your character goes with you; pick the video there." : "Add your character here first, or pick it there."}</p>
            </section>
          ) : null}

          {mode === "living" ? <section className={styles.createCard} aria-label="Picture motion"><LivingPanel image={image} onPreview={setLiving} /></section> : <>
          {fromVideo ? <section className={styles.createCard} aria-labelledby="video-movement-title">
            <h2 id="video-movement-title" className={styles.panelTitle}>Video movement</h2>
            <p className={styles.hint}>Poses, rhythm, orientation and movement across the frame follow your video. Your illustration’s face, outfit, colors and drawing style stay the same.</p>
            <div className={composer.instruction}>
              <label htmlFor="flipbook-video-detail" className={composer.label}>Additional direction (optional)</label>
              <div className={composer.field}>
                <textarea id="flipbook-video-detail" className={cn(composer.textarea, styles.detailInput)} rows={3} maxLength={DETAIL_MAX} placeholder="e.g. Keep the hand gestures especially clear" value={videoDetail} onChange={(event) => setVideoDetail(event.target.value)} />
              </div>
              <p className={styles.hint}>These notes refine the animation; they do not replace the video’s action or timing.</p>
            </div>
          </section> : <section className={styles.createCard} aria-labelledby="motion-direction-title">
            <h2 id="motion-direction-title" className={styles.panelTitle}>Motion & direction</h2>
            <fieldset className={composer.effects}>
              <legend className="sr-only">Choose a motion</legend>
              <SlidingTabs
                className={composer.tabs}
                tabs={ACTIONS.map((entry) => ({ id: entry.action, label: entry.label }))}
                value={action}
                onValueChange={(id) => { touched.current = true; setAction(id as CycleAction); if (!travels(id as CycleAction) && direction === "in_place") setDirection(facing); }}
              />
              <p className={composer.summary} aria-live="polite">{ACTIONS.find((entry) => entry.action === action)!.note}</p>
            </fieldset>

            <div className={styles.createFraming}>
              <div className={composer.group}>
                <label htmlFor="flipbook-camera-view" className={composer.label}>Camera view</label>
                <Select id="flipbook-camera-view" value={cameraView} options={VIEW_OPTIONS} onValueChange={(value) => { touched.current = true; const next = value as ViewPreference; setCameraView(next); if (["front", "back", "high", "low"].includes(next) && travels(action)) setDirection("in_place"); }} />
              </div>
              {(travels(action) || lateralView) && <div className={composer.group} role="group" aria-labelledby="flipbook-direction-label">
                <span id="flipbook-direction-label" className={composer.label}>{travels(action) ? "Screen movement" : "Facing"}</span>
                <SlidingTabs
                  key={travels(action) ? "direction" : "facing"}
                  className={composer.tabs}
                  tabs={(travels(action) ? DIRECTIONS : DIRECTIONS.filter((entry) => entry.id !== "in_place")).map((entry) => ({ id: entry.id, label: entry.label }))}
                  value={direction}
                  onValueChange={(id) => { touched.current = true; setDirection(id as Direction); }}
                />
              </div>}
            </div>
            <p className={styles.hint}>{cameraView === "original" ? "Keeps your character’s view. It won’t automatically turn into a side profile." : "The selected view stays fixed through every drawing. New angles may reveal details absent from the reference."}</p>

            <div className={composer.instruction}>
              <label htmlFor="flipbook-detail" className={composer.label}>Describe the motion</label>
              <div className={composer.field} data-filled={detail ? "" : undefined}>
                <textarea
                  id="flipbook-detail"
                  className={cn(composer.textarea, styles.detailInput)}
                  rows={3}
                  maxLength={DETAIL_MAX}
                  placeholder={PLACEHOLDER[action]}
                  value={detail}
                  onChange={(event) => { touched.current = true; setDetail(event.target.value); }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
                  }}
                />
                <div className={composer.hint}>
                  <span className={composer.hintKeys}><kbd>Enter</kbd> to create · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
                  <span className="tabular-nums">{detail.length}/{DETAIL_MAX}</span>
                </div>
              </div>
            </div>

            <div className={composer.ideas}>
              {look?.ideas.length ? (
                <div className={composer.group} role="group" aria-label="Ideas for this drawing">
                  <span className={composer.groupLabel}><HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />Ideas for this drawing</span>
                  <div className={composer.chips}>
                    {look.ideas.map((idea) => (
                      <SuggestionChip size="xs" key={`${idea.action}-${idea.direction}-${idea.detail}`} onClick={() => pickIdea(idea)} className={composer.chip}>{ideaLabel(idea)}</SuggestionChip>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={composer.group} role="group" aria-label="Ideas for this motion">
                  <span className={composer.groupLabel}><HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />Try</span>
                  <div className={composer.chips}>
                    {IDEAS[action].map((idea) => (
                      <SuggestionChip size="xs" key={idea} onClick={() => { touched.current = true; setDetail(idea); }} className={composer.chip}>{idea}</SuggestionChip>
                    ))}
                  </div>
                </div>
              )}
              {look?.layers.scene ? (
                <label className={styles.keepScene}>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">Keep the scene as the background</span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">Focus redraws it without the character (1 drawing), so it can stay still or move behind the animation.</span>
                  </span>
                  <Switch checked={keepScene} onCheckedChange={setKeepScene} label="Keep the scene as the background" />
                </label>
              ) : null}
            </div>

          </section>}

          <div className={styles.createFooter}>
            <p className={styles.hint}>{fromVideo ? "The selected video segment will guide this animation." : `Focus will animate “${motionInstruction}”`}</p>
            <Disclosure title="Review animation instructions" className={styles.createDisclosure}>
              <p className={styles.promptPreview}>{prompt}</p>
            </Disclosure>
            <div className={styles.createSubmit}>
              <Button className={composer.generate} type="submit" variant="ai" size="lg" disabled={!canSubmit} aria-busy={creating || undefined}>
                {creating ? <Spinner /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={16} strokeWidth={1.75} />}
                {mode === "sequence" ? "Prepare continuous animation" : "Create animation"}
              </Button>
              {blockedReason ? <p className={composer.blocked}>{blockedReason}</p> : null}
            </div>
          </div>
          </>}
        </form>}
      </aside>
    </div>
  );

  return (
    <section className={shell.empty} aria-labelledby="flipbook-title">
      <h1 id="flipbook-title" className={shell.emptyTitle}>Start with a drawing</h1>
      <p className="text-sm text-muted-foreground">One character, PNG, JPEG or WebP. Then pick how it should move.</p>
      <CharacterPicker />

      <div className={shell.drop}>
        {progress !== null ? (
          <div className={upload.uploadPane}>
            <div className={`${upload.uploadCard} backdrop-blur-xl`} aria-busy="true">
              <div className={upload.fileRow}>
                <span className={upload.fileIcon} aria-hidden="true"><FeatherSparkleColored24 className={styles.dropIcon} width={40} height={40} /></span>
                <div className={upload.fileDetails}>
                  <p className={upload.fileName} title={pending?.name}>{pending?.name}</p>
                  <p className={upload.fileMeta}>{pending ? `${formatBytes(pending.size)} · Image` : "Image"}</p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="Cancel upload" onClick={() => { handle.current?.abort(); handle.current = null; setProgress(null); }}>
                  <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
                </Button>
              </div>
              <div className={upload.progressLabel}>
                <span><Spinner />{progress >= 1 ? "Checking your image…" : "Uploading your image…"}</span>
                {progress < 1 ? <span className={upload.percentage}>{Math.round(progress * 100)}%</span> : null}
              </div>
              <div
                role="progressbar"
                aria-label="Image upload"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress < 1 ? Math.round(progress * 100) : undefined}
                className={upload.track}
              >
                <div className={upload.fill} style={{ transform: `scaleX(${progress})` }} />
              </div>
            </div>
          </div>
        ) : (
          <div className={upload.dropPane}>
            <FileUpload
              variant="centered"
              multiple={false}
              maxFiles={1}
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              value={[]}
              onFilesAdded={(_items, files) => { if (files[0]) start(files[0]); }}
              title="Drop your drawing here"
              dropzoneIcon={<FeatherSparkleColored24 className={styles.dropIcon} width={88} height={88} />}
              description={`PNG, JPEG or WebP · ${formatBytes(MAX_IMAGE_BYTES)} max · any camera view`}
              browseLabel="Choose an image"
              browseVariant="default"
              classNames={{ root: upload.upload, dropzone: upload.dropzone }}
            />
            <p className={upload.next}>Add a character. The motion comes next.</p>
          </div>
        )}
        {error ? <p className={styles.hint} data-invalid="" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
