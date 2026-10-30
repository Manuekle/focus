"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AiPaintbrushIcon, ArrowLeftRightIcon, Cancel01Icon, Image02Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { FeatherSparkleColored24 } from "../../components/icons/FeatherSparkleColored24";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FileUpload } from "../../components/motion/file-upload";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { Slider } from "../../components/ui/slider";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { VideoPlayer } from "../../components/ui/video-player";
import { useToast } from "../../components/toast-provider";
import { cn } from "../../lib/utils";
import { formatBytes } from "../../shared/media";
import { ROTOSCOPE_LIMITS, type RotoscopeRun } from "../../shared/rotoscope";
import { characterUrls } from "../../shared/characters";
import composer from "../_editor/composer.module.css";
import view from "../_editor/editor-view.module.css";
import upload from "../_editor/studio-upload.module.css";
import shell from "../editor/studio.module.css";
import fb from "../flipbook/flipbook.module.css";
import { characterFile, handoffImageUrl } from "../characters/character-client";
import { CharacterPicker } from "../flipbook/character-picker";
import { createRun } from "./rotoscope-client";
import styles from "./rotoscope.module.css";

const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm";
const FPS_PRESETS = [6, 8, 9, 12, 24] as const;

export const CHECKS = [
  { name: "pose", label: "Pose", note: "DWPose measures every clear limb against the video frame; mirrored drawings are caught." },
  { name: "scale", label: "Size", note: "Hair and soles must land on the grid lines, so the character keeps one size." },
  { name: "proportions", label: "Proportions", note: "Every clear limb and the head are measured against the character’s own lengths: no over-long arms or legs." },
  { name: "alpha", label: "Background", note: "The magenta background must key out cleanly: nothing cut, no leftovers." },
  { name: "review", label: "Visual review", note: "Muse Spark compares video and drawing part by part, and the character’s design." },
] as const;

type Video = { readonly file: File; readonly url: string; readonly duration: number | null; readonly width: number; readonly height: number };

/**
 * A new run, laid out like Flipbook's create page: the video on the left,
 * the character and the frame settings on the right.
 */
export function RotoscopeCreate({ disabled, onCreated }: { readonly disabled: boolean; readonly onCreated: (run: RotoscopeRun) => void }) {
  const { toast } = useToast();
  const [video, setVideo] = useState<Video | null>(null);
  /** `savedId`: picked from My characters (ringed in the picker). */
  const [character, setCharacter] = useState<{ file: File; url: string; savedId?: string } | null>(null);
  const [loadingCharacter, setLoadingCharacter] = useState(false);
  const [fps, setFps] = useState<number>(ROTOSCOPE_LIMITS.defaultFps);
  const [start, setStart] = useState(0);
  const [seconds, setSeconds] = useState(1);
  const [whole, setWhole] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const handle = useRef<{ abort: () => void } | null>(null);
  const characterInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => handle.current?.abort(), []);
  // Keyed by the URL itself: `video` is replaced when its metadata arrives, and revoking then would cut off the player mid-playback.
  const videoUrl = video?.url;
  const characterUrl = character?.url;
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (characterUrl) URL.revokeObjectURL(characterUrl); }, [characterUrl]);

  /** A saved character's version, or an image handed over from Flipbook, loaded as this run's upload. */
  const loadCharacter = async (url: string, name: string, savedId?: string) => {
    setLoadingCharacter(true);
    try {
      const file = await characterFile(url, name);
      setCharacter({ file, url: URL.createObjectURL(file), ...(savedId ? { savedId } : {}) });
    } catch (cause) {
      toast({ title: "Couldn’t load the character", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setLoadingCharacter(false);
    }
  };
  // Arriving from Flipbook or My characters (?character=&version= or ?image=): the character comes along.
  const params = useSearchParams();
  const handoff = handoffImageUrl({ character: params.get("character"), version: params.get("version"), image: params.get("image") });
  const handedOff = useRef(false);
  useEffect(() => {
    if (!handoff || handedOff.current) return;
    handedOff.current = true;
    void loadCharacter(handoff, "character", params.get("character") ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the URL the page opened with
  }, [handoff]);

  const pickVideo = (file: File) => {
    setVideo({ file, url: URL.createObjectURL(file), duration: null, width: 0, height: 0 });
    setStart(0);
  };

  const duration = video?.duration ?? null;
  const lastStart = duration === null ? 0 : Math.max(0, Math.floor((duration - 1) * 10) / 10);
  const maxLength = duration === null ? ROTOSCOPE_LIMITS.maxSeconds : Math.max(1, Math.min(ROTOSCOPE_LIMITS.maxSeconds, Math.floor((duration - start) * 2) / 2));
  const length = Math.min(seconds, maxLength);
  const covered = duration === null ? null : Math.max(0, whole ? duration - start : Math.min(length, duration - start));
  const frames = covered === null ? null : Math.round(covered * fps);
  const blocked = disabled ? "Sign in to start a run."
    : !character ? (loadingCharacter ? "Loading your character…" : "Add your character to continue.")
      : duration === null ? "Reading the video…"
        : covered !== null && covered > ROTOSCOPE_LIMITS.maxSeconds ? `One run covers at most ${ROTOSCOPE_LIMITS.maxSeconds} s. Choose a shorter part.`
          : frames !== null && frames > ROTOSCOPE_LIMITS.maxFrames ? `One run holds at most ${ROTOSCOPE_LIMITS.maxFrames} frames. Lower the frame rate or the length.` : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !video || !character) return;
    setProgress(0);
    const next = createRun({ video: video.file, character: character.file, fps, start, seconds: whole ? null : length }, setProgress);
    handle.current = next;
    try {
      onCreated(await next.promise);
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "aborted")) toast({ title: "Couldn’t start the run", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setProgress(null);
      handle.current = null;
    }
  };

  if (!video) return (
    <section className={shell.empty} aria-labelledby="rotoscope-title">
      <h1 id="rotoscope-title" className={shell.emptyTitle}>Test a video in Rotoscope</h1>
      <p className="text-sm text-muted-foreground">The sandbox before Flipbook: every frame of the video is redrawn with your character in the same pose, on a transparent background, and checked frame by frame. Approve at least one second, then open it in Flipbook as an editable animation. Use only videos and images you have the rights to.</p>
      {character || loadingCharacter ? <p className="text-sm text-foreground">{loadingCharacter ? "Loading your character…" : "Your character is ready. Now pick the video to copy."}</p> : null}
      <div className={shell.drop}>
        <div className={upload.dropPane}>
          <FileUpload
            variant="centered"
            multiple={false}
            maxFiles={1}
            accept={VIDEO_ACCEPT}
            value={[]}
            onFilesAdded={(_items, files) => { if (files[0]) pickVideo(files[0]); }}
            title="Drop the video to copy here"
            dropzoneIcon={<FeatherSparkleColored24 className={fb.dropIcon} width={88} height={88} />}
            description="MP4 or MOV · one person, whole body in frame"
            browseLabel="Choose a video"
            browseVariant="default"
            classNames={{ root: upload.upload, dropzone: upload.dropzone }}
          />
        </div>
      </div>
    </section>
  );

  return (
    <div className={cn(view.editor, fb.createWorkspace)} data-variant="page">
      <h1 className="sr-only">New rotoscope run</h1>
      <section aria-label="Movement video" className={cn(view.preview, fb.createPreview)}>
        <figure className={fb.drawingFigure}>
          <div className={fb.drawingStage}>
            <VideoPlayer
              src={video.url}
              label="Movement video"
              className={styles.createVideo}
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                if (!Number.isFinite(element.duration)) return;
                setVideo((current) => (current?.url === video.url ? { ...current, duration: element.duration, width: element.videoWidth, height: element.videoHeight } : current));
              }}
            />
          </div>
        </figure>
        <div className={view.fileRow}>
          <div className={view.fileDetails}>
            <p className={view.fileName} title={video.file.name}>{video.file.name}</p>
            <p className={view.fileMeta}>{duration !== null ? `${duration.toFixed(2)} s · ${video.width}×${video.height} · ` : ""}{formatBytes(video.file.size)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setVideo(null)} disabled={progress !== null}>
            <HugeiconsIcon icon={ArrowLeftRightIcon} size={14} strokeWidth={1.5} />New video
          </Button>
        </div>
        <section className={fb.reading} aria-live="polite">
          <p className={fb.readingSummary}>
            {frames !== null ? <>{frames} frames at {fps} fps, from {start.toFixed(1)} s{whole ? " to the end" : ` to ${(start + (covered ?? 0)).toFixed(1)} s`}. </> : null}
            The letterbox is cropped and each frame is drawn in order; a frame that fails {ROTOSCOPE_LIMITS.maxAttempts} times stops the run there, and drawing resumes from it.
          </p>
        </section>
      </section>

      <aside className={cn(view.controls, fb.createControls)}>
        <form className={fb.createForm} onSubmit={(event) => void submit(event)}>
          <section className={fb.createCard} aria-labelledby="ro-character-title">
            <h2 id="ro-character-title" className={fb.panelTitle}>Your character</h2>
            <input ref={characterInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) setCharacter({ file, url: URL.createObjectURL(file) });
            }} />
            {character ? (
              <div className={styles.characterRow}>
                <span className={fb.referenceImage}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
                  <img src={character.url} alt="Your character" />
                </span>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className={fb.uploadName}>{character.file.name}</p>
                  <p className={fb.hint}>Drawn in every frame with this exact design.</p>
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => characterInput.current?.click()}>
                    <HugeiconsIcon icon={Image02Icon} size={14} strokeWidth={1.75} />Replace
                  </Button>
                </div>
              </div>
            ) : loadingCharacter ? (
              <p className={cn(fb.hint, "flex items-center gap-2")}><Spinner className="size-3.5" />Loading your character…</p>
            ) : (
              <>
                <p className={fb.hint}>One full-body character, head to feet, facing the camera, on a plain light background.</p>
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => characterInput.current?.click()}>
                  <HugeiconsIcon icon={Image02Icon} size={14} strokeWidth={1.75} />Upload image
                </Button>
              </>
            )}
            <CharacterPicker title="Or pick one of your characters" selected={character?.savedId ?? null} onPick={(entry) => void loadCharacter(characterUrls.version(entry.id, entry.selectedVersionId), entry.name, entry.id)} />
          </section>

          <section className={fb.createCard} aria-labelledby="ro-frames-title">
            <h2 id="ro-frames-title" className={fb.panelTitle}>Frames</h2>
            <fieldset className={composer.effects}>
              <legend className={composer.label}>Frames per second</legend>
              <SlidingTabs className={composer.tabs} tabs={FPS_PRESETS.map((value) => ({ id: String(value), label: `${value}` }))} value={String(fps)} onValueChange={(id) => setFps(Number(id))} />
              <p className={composer.summary}>{fps === ROTOSCOPE_LIMITS.defaultFps ? "9 per second: the rate of your own frame export." : fps >= 24 ? "Every film frame: smoothest, most drawings." : `${fps} drawings for each second of video.`}</p>
            </fieldset>
            <div className={fb.createTiming}>
              <div className={fb.controlField}>
                <div className={fb.controlHeading}><span className={composer.label}>Start</span><span className={fb.controlValue}>{start.toFixed(1)} s</span></div>
                <Slider min={0} max={Math.max(0.1, lastStart)} step={0.1} value={[Math.min(start, lastStart)]} onValueChange={([value]) => setStart(value)} disabled={duration === null || lastStart === 0} aria-label="Start" aria-valuetext={`${start.toFixed(1)} seconds`} />
              </div>
              <div className={fb.controlField}>
                <div className={fb.controlHeading}><span className={composer.label}>Length</span><span className={fb.controlValue}>{whole ? "to the end" : `${length.toFixed(1)} s`}</span></div>
                <Slider min={1} max={Math.max(1.5, maxLength)} step={0.5} value={[length]} onValueChange={([value]) => setSeconds(value)} disabled={whole || duration === null || maxLength <= 1} aria-label="Length" aria-valuetext={`${length.toFixed(1)} seconds`} />
              </div>
              <label className={cn(fb.keepScene, styles.fullRow)}>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">To the end of the video</span>
                  <span className="block text-[11px] leading-4 text-muted-foreground">Start with one second to check the result before a long run.</span>
                </span>
                <Switch checked={whole} onCheckedChange={setWhole} label="To the end of the video" />
              </label>
            </div>
          </section>

          <div className={fb.createFooter}>
            <p className={fb.cost}><span>Frames to draw</span><strong>{frames ?? "—"}</strong></p>
            <p className={fb.hint}>Up to {frames !== null ? frames * ROTOSCOPE_LIMITS.maxAttempts : "—"} Muse Image drawings if every frame needed every attempt; most frames pass on the first or second.</p>
            <Disclosure title="How each drawing is checked">
              <ul className={fb.checkList}>
                {CHECKS.map((check) => <li key={check.name} data-source="review"><strong className="font-medium text-foreground">{check.label}.</strong> {check.note}</li>)}
              </ul>
            </Disclosure>
            <div className={fb.createSubmit}>
              {progress !== null ? (
                <div className={styles.uploading}>
                  <span className={fb.inline}><Spinner />{progress >= 1 ? "Preparing the run…" : `Uploading ${Math.round(progress * 100)}%`}</span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel upload" onClick={() => handle.current?.abort()}>
                    <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.5} />
                  </Button>
                </div>
              ) : null}
              <Button className={composer.generate} type="submit" variant="ai" size="lg" disabled={Boolean(blocked) || progress !== null} aria-busy={progress !== null || undefined}>
                {progress !== null ? <Spinner /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={16} strokeWidth={1.75} />}
                Prepare {frames ?? ""} frames
              </Button>
              {blocked ? <p className={composer.blocked}>{blocked}</p> : null}
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}
