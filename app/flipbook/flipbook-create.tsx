"use client";

import { useEffect, useRef, useState } from "react";
import { AiMagicIcon, AiSearch02Icon, ArrowLeftRightIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Skeleton } from "../../components/ui/skeleton";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { Switch } from "../../components/ui/switch";
import { FeatherSparkleColored24 } from "../../components/icons/FeatherSparkleColored24";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FileUpload } from "../../components/motion/file-upload";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { formatBytes } from "../../shared/media";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  actionSpec,
  MAX_IMAGE_BYTES,
  hasAcceptedImageExtension,
  imageUrls,
  type AnimationAction,
  type FlipbookImage,
  type ImageIdea,
  type ImageLook,
} from "../../shared/flipbook";
import { cn } from "../../lib/utils";
import { FlipbookApiError, flipbookApi, uploadCharacter, type UploadHandle } from "./flipbook-client";
import shell from "../editor/studio.module.css";
import composer from "../_editor/composer.module.css";
import upload from "../_editor/studio-upload.module.css";
import view from "../_editor/editor-view.module.css";
import styles from "./flipbook.module.css";

type Direction = "left" | "in_place" | "right";

const ACTIONS: readonly { action: AnimationAction; label: string; note: string }[] = [
  { action: "walk", label: "Walk", note: "A relaxed stride in eight drawings, with the classic up-and-down bob." },
  { action: "run", label: "Run", note: "Fast and leaning forward; both feet leave the ground mid-stride." },
  { action: "jump", label: "Jump", note: "Crouch, push off, tuck at the top, land and recover, on the spot." },
  { action: "fight", label: "Fight", note: "Shadowboxing in place: guard, a jab, a cross, back to guard." },
  { action: "wave", label: "Wave", note: "Raises a hand and waves hello, then lowers it again." },
  { action: "idle", label: "Idle", note: "Breathes, blinks and shifts its weight a little: alive while standing still." },
];

/** Walks and runs can travel; the other motions stay on the spot and only face a side. */
const travels = (action: AnimationAction) => actionSpec(action).travels;

const DIRECTIONS: readonly { id: Direction; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "in_place", label: "In place" },
  { id: "right", label: "Right" },
];

const DETAIL_MAX = 400;

export type CreateOptions = { readonly action?: AnimationAction; readonly keepScene?: boolean };

const VIEW_LABEL: Record<ImageLook["analysis"]["view"], string> = { side: "Side view", three_quarter: "Three-quarter view", front: "Front view", back: "Back view", unclear: "View unclear" };

const VERB: Record<AnimationAction, string> = { walk: "Walk", run: "Run", jump: "Jump", fight: "Shadowbox", wave: "Wave", idle: "Idle" };

/** "Run right · hair and tail flowing", "Wave facing left · shy" */
function ideaLabel(idea: ImageIdea): string {
  const where = idea.direction === "in_place" ? "in place" : travels(idea.action) ? idea.direction : `facing ${idea.direction}`;
  return `${VERB[idea.action]} ${where}${idea.detail ? ` · ${idea.detail}` : ""}`;
}

const PLACEHOLDER: Record<AnimationAction, string> = {
  walk: "How does it walk? e.g. “cheerful, arms swinging wide”",
  run: "How does it run? e.g. “sprinting, hair flying back”",
  jump: "How does it jump? e.g. “a big joyful leap”",
  fight: "How does it fight? e.g. “quick and light on its feet”",
  wave: "How does it wave? e.g. “shy, a small wave”",
  idle: "How does it stand? e.g. “calm, a slow breath”",
};

const IDEAS: Record<AnimationAction, readonly string[]> = {
  walk: ["cheerful, arms swinging wide", "sneaking on tiptoe", "tired, dragging its feet"],
  run: ["sprinting at full speed", "a light jog", "running late, panicked"],
  jump: ["a big joyful leap", "a small excited hop", "a heavy, powerful jump"],
  fight: ["quick and light on its feet", "heavy, powerful punches", "a confident boxer"],
  wave: ["an excited, big wave", "shy, a small wave", "waving goodbye"],
  idle: ["calm, slow breathing", "impatient, tapping its foot", "proud, chest out"],
};

/** The instruction the pickers stand for; the analysis reads it like typed text. */
function instruction(action: AnimationAction, direction: Direction, detail: string, facing: "left" | "right"): string {
  const side = direction === "in_place" ? facing : direction;
  const base =
    action === "fight" ? `Shadowbox: a jab and a cross, facing ${side}`
    : action === "jump" ? `Jump in place, facing ${side}`
    : action === "wave" ? `Wave hello, facing ${side}`
    : action === "idle" ? `Stand idle, breathing and blinking, facing ${side}`
    : direction === "in_place" ? `${action === "run" ? "Run" : "Walk"} in place, facing ${side}`
    : action === "run" ? `Run across the screen to the ${direction}`
    : `Walk to the ${direction}`;
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
}: {
  readonly onCreate: (image: FlipbookImage, prompt: string, options: CreateOptions) => void;
  readonly creating: boolean;
  readonly blockedReason?: string;
}) {
  const [image, setImage] = useState<FlipbookImage | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<AnimationAction>("walk");
  const [direction, setDirection] = useState<Direction>("right");
  const [detail, setDetail] = useState("");
  const [look, setLook] = useState<ImageLook | null>(null);
  const [lookFailed, setLookFailed] = useState(false);
  const [keepScene, setKeepScene] = useState(true);
  const [layer, setLayer] = useState<"original" | "character" | "scene">("original");
  const touched = useRef(false);
  const handle = useRef<UploadHandle | null>(null);

  useEffect(() => () => handle.current?.abort(), []);

  // Once uploaded, Focus reads the drawing: what is in it, motions that suit
  // it, and its layers. Its first idea becomes the starting pick, unless the
  // person has already chosen.
  const imageId = image?.id;
  useEffect(() => {
    if (!imageId) return;
    let canceled = false;
    setLook(null);
    setLookFailed(false);
    setLayer("original");
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
          setDirection(idea.direction);
          setDetail(idea.detail);
        } else if (next.analysis.facing === "left" || next.analysis.facing === "right") {
          setDirection(next.analysis.facing);
        }
      },
      () => { if (!canceled) setLookFailed(true); },
    );
    return () => { canceled = true; };
  }, [imageId]);

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
  const prompt = instruction(action, direction, detail, facing);
  const canSubmit = Boolean(image) && !creating && !blockedReason;
  const submit = () => {
    if (!image || !canSubmit) return;
    // With a reading, the picked motion says which action it is, and its character facts are reused.
    onCreate(image, prompt, look ? { action, keepScene: look.layers.scene && keepScene } : {});
  };
  const layerSrc = image && layer !== "original" ? imageUrls.layer(image.id, layer) : image?.url;

  if (image) return (
    <div className={view.editor} data-variant="page">
      <h1 id="flipbook-title" className="sr-only">Make your drawing move</h1>
      <section aria-label="Drawing" className={view.preview}>
        <figure className={styles.drawingFigure}>
          <div className={styles.drawingStage} data-transparent={image.hasAlpha || layer !== "original" || undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
            <img key={layer} src={layerSrc} alt={layer === "character" ? "Your character, cut out" : layer === "scene" ? "The scene with the character taken out" : "Your character illustration"} width={image.width} height={image.height} className={layer === "character" ? styles.layerCharacter : undefined} />
            {!look && !lookFailed ? <Skeleton className={styles.readingSweep} /> : null}
          </div>
        </figure>
        {look?.layers.character ? (
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
      </section>

      <aside className={view.controls}>
        <form className={composer.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <section className={styles.reading} aria-live="polite" aria-busy={!look && !lookFailed}>
            <span className={composer.groupLabel}><HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />{look ? "In this drawing" : lookFailed ? "Pick a motion" : "Reading your drawing…"}</span>
            {look ? (
              <>
                {look.summary ? <p className={styles.readingSummary}>{look.summary}</p> : null}
                <div className={composer.chips}>
                  <span className={styles.fact}>{look.analysis.subject}</span>
                  {look.analysis.characterCount > 1 ? <span className={styles.fact}>{look.analysis.characterCount} characters · animates one</span> : null}
                  <span className={styles.fact}>{VIEW_LABEL[look.analysis.view]}</span>
                  {look.setting ? <span className={styles.fact}>{look.setting}</span> : <span className={styles.fact}>No background</span>}
                </div>
                {look.warnings.length ? (
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

          <fieldset className={composer.effects}>
            <legend className="sr-only">Choose a motion</legend>
            <SlidingTabs
              className={composer.tabs}
              tabs={ACTIONS.map((entry) => ({ id: entry.action, label: entry.label }))}
              value={action}
              onValueChange={(id) => { touched.current = true; setAction(id as AnimationAction); if (!travels(id as AnimationAction) && direction === "in_place") setDirection(facing); }}
            />
            <p className={composer.summary} aria-live="polite">{ACTIONS.find((entry) => entry.action === action)!.note}</p>
          </fieldset>

          <fieldset className={composer.effects}>
            <legend className={composer.label}>{travels(action) ? "Direction" : "Facing"}</legend>
            <SlidingTabs
              key={travels(action) ? "direction" : "facing"}
              className={composer.tabs}
              tabs={(travels(action) ? DIRECTIONS : DIRECTIONS.filter((entry) => entry.id !== "in_place")).map((entry) => ({ id: entry.id, label: entry.label }))}
              value={direction}
              onValueChange={(id) => { touched.current = true; setDirection(id as Direction); }}
            />
          </fieldset>

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
            <p className={composer.groupLabel}>Focus will animate “{prompt}”</p>
          </div>

          <div className={composer.submit}>
            <Button className={composer.generate} type="submit" variant="ai" size="lg" disabled={!canSubmit} aria-busy={creating || undefined}>
              {creating ? <Spinner /> : <HugeiconsIcon icon={AiMagicIcon} size={16} strokeWidth={1.75} />}
              Create animation
            </Button>
            {blockedReason ? <p className={composer.blocked}>{blockedReason}</p> : null}
          </div>
        </form>
      </aside>
    </div>
  );

  return (
    <section className={shell.empty} aria-labelledby="flipbook-title">
      <h1 id="flipbook-title" className={shell.emptyTitle}>Start with a drawing</h1>
      <p className="text-sm text-muted-foreground">One character, PNG, JPEG or WebP. Then pick how it should move.</p>

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
              description={`PNG, JPEG or WebP · ${formatBytes(MAX_IMAGE_BYTES)} max · full body, side view`}
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
