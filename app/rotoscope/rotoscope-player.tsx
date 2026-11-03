"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ArrowLeftRightIcon, BlurIcon, Image01Icon, MaximizeScreenIcon, MinimizeScreenIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, Refresh01Icon, RepeatIcon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { DropdownMenu } from "radix-ui";
import { HugeiconsIcon } from "../../components/icons/icon";
import { AspectRatio } from "../../components/motion/aspect-ratio";
import { Button } from "../../components/ui/button";
import { ColorPicker } from "../../components/ui/color-picker";
import { MediaImage } from "../../components/ui/media-image";
import { Skeleton } from "../../components/ui/skeleton";
import { Select } from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner";
import { FRAME_RATIO, type BackdropKind } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import styles from "./rotoscope.module.css";

/** The preview speeds offered. */
export const SPEED_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** plate: the video's room with the person taken out (one picture per run). */
export type PlayerBackground = "checker" | "color" | "plate";
/** compare: the video and the drawing beside each other; slider: one over the other, cut at a draggable divider; drawing: alone. */
export type PlayerView = "compare" | "slider" | "drawing";
const VIEWS: readonly { readonly value: PlayerView; readonly label: string }[] = [
  { value: "compare", label: "Side by side" },
  { value: "slider", label: "Wipe" },
  { value: "drawing", label: "Drawing" },
];
/** `direct`: drawn on the video's own framing (direct.ts), shown as it is; otherwise moved by `framing`. */
export type PlayerFrame = { readonly index: number; readonly drawing: string; readonly source: string; readonly direct?: boolean };

/** Smoother: how much of the outgoing drawing is mixed in at a cut, and over what share of the drawing's time it fades. */
const SMOOTHER = { strength: 0.5, share: 0.75 } as const;
/** Centres the empty-state and live-label text in the frame's content layer. */
const STAGE_CONTENT = "grid place-items-center";
const SMOOTHER_KEY = "focus.rotoscope.smoother";

/** What the stage shows while a frame is being drawn: the video frame, and the attempt once it exists. */
export type LiveStage = { readonly index: number; readonly source: string; readonly drawing: string | null; readonly label: string; readonly direct?: boolean };

/**
 * The preview, as in Flipbook: approved drawings play at the run's frame
 * rate times 0.1× to 4×, beside their video frames or alone. While a run
 * draws, the stage follows the frame in progress instead.
 */
export function RotoscopePlayer({ frames, fps, live, focus, onSelect, strip, compact = false, audioSrc, sound, onSoundChange, backdrops, onMakeBackdrop, framing = null }: {
  readonly frames: readonly PlayerFrame[];
  readonly fps: number;
  readonly live: LiveStage | null;
  /** The frame selected in the strip: shown when paused, drawn or not. */
  readonly focus: { readonly index: number; readonly source: string; readonly drawing: string | null; readonly direct?: boolean } | null;
  readonly onSelect: (index: number) => void;
  readonly strip: ReactNode;
  /** A shorter stage, for the drawer over the canvas. */
  readonly compact?: boolean;
  /** The reference video's sound from the run's start; null when the video has none. */
  readonly audioSrc: string | null;
  readonly sound: boolean;
  readonly onSoundChange: (on: boolean) => void;
  /** The run's backgrounds behind the drawings, null until made; without the prop only the plain backgrounds are offered. */
  readonly backdrops?: Readonly<Record<BackdropKind, string | null>>;
  /** Makes one (a Muse Image picture); the run comes back with it. */
  readonly onMakeBackdrop?: (kind: BackdropKind) => Promise<void>;
  /** Where the drawings' canvas sits on the video frame as the video pane shows it (RotoscopeRun.framing): drawings shown at the video's own size. */
  readonly framing?: { readonly scale: number; readonly x: number; readonly y: number } | null;
}) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [view, setView] = useState<PlayerView>("compare");
  // Where the slider's divider sits, as a share of the width: the video is left of it, the drawing right.
  const [split, setSplit] = useState(50);
  const [background, setBackground] = useState<PlayerBackground>("checker");
  const [color, setColor] = useState("#ffffff");
  const stageColor = background === "color" ? { background: color } : undefined;
  const [making, setMaking] = useState<BackdropKind | null>(null);
  const backdropSrc = background === "plate" ? backdrops?.plate ?? null : null;
  const makeBackdrop = async (kind: BackdropKind) => {
    if (!onMakeBackdrop) return;
    setMaking(kind);
    try { await onMakeBackdrop(kind); } finally { setMaking(null); }
  };
  const backdrop = backdropSrc ? <MediaImage src={backdropSrc} alt="" aria-hidden loading="eager" draggable={false} /> : null;
  // Off by default: playback shows the drawings exactly as approved.
  const [smoother, setSmoother] = useState(false);
  useEffect(() => {
    try { setSmoother(localStorage.getItem(SMOOTHER_KEY) === "1"); } catch { /* storage unavailable: stays off */ }
  }, []);
  const toggleSmoother = (on: boolean) => {
    setSmoother(on);
    try { localStorage.setItem(SMOOTHER_KEY, on ? "1" : "0"); } catch { /* not remembered */ }
  };
  const preloaded = useRef(new Map<string, HTMLImageElement>());
  const track = useRef<HTMLAudioElement | null>(null);
  // The whole player (stage and controls) fills the screen, as the app's video player does.
  const root = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current);
    setCanFullscreen(document.fullscreenEnabled);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { /* fullscreen refused: the preview stays in the panel */ }
  };
  const current = Math.min(position, Math.max(0, frames.length - 1));
  const frame = frames[current];
  const rate = fps * speed;
  const showLive = live !== null && !playing;

  // Picking a drawn frame in the strip moves the playhead there.
  const focusIndex = focus?.index;
  useEffect(() => {
    const at = frames.findIndex((entry) => entry.index === focusIndex);
    if (at >= 0) setPosition(at);
  }, [focusIndex, frames]);
  const focusPlayable = focus !== null && frames.some((entry) => entry.index === focus.index);

  // Every frame is decoded before it is due, so playback keeps its timing.
  useEffect(() => {
    for (const entry of frames) {
      for (const url of [entry.drawing, entry.source]) {
        if (preloaded.current.has(url)) continue;
        const image = new Image();
        image.src = url;
        preloaded.current.set(url, image);
      }
    }
  }, [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = setTimeout(() => {
      setPosition((value) => {
        const next = Math.min(value, frames.length - 1) + 1;
        if (next < frames.length) return next;
        if (loop) return 0;
        setPlaying(false);
        return value;
      });
    }, 1000 / rate);
    return () => clearTimeout(timer);
  }, [playing, current, rate, loop, frames.length]);

  // The video's sound follows the playhead: frame N is heard from (N - 1) / fps, at the preview speed.
  const listening = sound && audioSrc !== null;
  useEffect(() => {
    if (!listening) return;
    const element = new Audio(audioSrc);
    element.preload = "auto";
    track.current = element;
    return () => { element.pause(); element.removeAttribute("src"); element.load(); track.current = null; };
  }, [listening, audioSrc]);
  const playhead = frame ? (frame.index - 1) / fps : 0;
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    if (!listening || !playing || !frame) { element.pause(); return; }
    element.playbackRate = speed;
    // Frames are timed by a timer, the sound by the clock: only a real drift (or a loop) moves it.
    if (Math.abs(element.currentTime - playhead) > 0.25) element.currentTime = playhead;
    if (element.paused) void element.play().catch(() => undefined);
  }, [listening, playing, playhead, speed, frame]);

  const step = (delta: number) => {
    if (!frames.length) return;
    setPlaying(false);
    const next = Math.max(0, Math.min(frames.length - 1, current + delta));
    setPosition(next);
    onSelect(frames[next].index);
  };

  const still = !showLive && !playing && focus !== null && !focusPlayable ? focus : null;
  const shown = showLive ? { source: live.source, drawing: live.drawing, direct: live.direct } : still ?? (frame ? { source: frame.source, drawing: frame.drawing, direct: frame.direct } : null);
  const panes = view === "compare" ? 2 : 1;
  // The drawing moved onto the video's framing, so it stands at the size and place of the person in the video pane.
  const framed = (drawing: ReactNode) => framing && !shown?.direct ? (
    <div className={styles.framed} style={{ transform: `translate(${framing.x * 100}%, ${framing.y * 100}%) scale(${framing.scale})` }}>{drawing}</div>
  ) : drawing;
  const drawingContent = shown?.drawing && smoother && playing && !showLive && !still ? framed(
    <SmoothDrawing src={shown.drawing} duration={1000 / rate} />,
  ) : shown?.drawing ? framed(
    <StageImage src={shown.drawing} alt="Drawing" />,
  ) : showLive ? (
    <>
      <Skeleton className={fb.working} />
      <span className={fb.workingLabel}>{live.label}</span>
    </>
  ) : <span className={fb.stageEmpty}>{still ? "Not drawn yet" : "No approved drawing yet"}</span>;

  const dragTo = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)));
  };
  const onDividerKey = (event: KeyboardEvent<HTMLElement>) => {
    const by = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") setSplit((value) => Math.max(0, value - by));
    else if (event.key === "ArrowRight") setSplit((value) => Math.min(100, value + by));
    else if (event.key === "Home") setSplit(0);
    else if (event.key === "End") setSplit(100);
    else return;
    event.preventDefault();
  };

  return (
    <div ref={root} className={`${fb.player} ${styles.player}`}>
      <div className={compact ? `${fb.lightTable} ${styles.compactTable}` : fb.lightTable}>
        <div className={styles.stagePair} data-panes={panes} style={{ ...(compact ? { "--stage-height": "min(44vh, 420px)" } : {}) } as CSSProperties}>
          {view === "compare" ? (
            <div className={fb.stage} data-transparent="">
              <AspectRatio ratio={FRAME_RATIO} animated={false} className={styles.stagePane} contentClassName={STAGE_CONTENT}>
                {shown ? (
                  <StageImage src={shown.source} alt="Video frame" />
                ) : <span className={fb.stageEmpty}>No frames yet</span>}
              </AspectRatio>
            </div>
          ) : null}
          {view === "slider" ? (
            <div
              className={`${fb.stage} ${styles.slider}`}
              data-transparent={background === "checker" ? "" : undefined}
              style={stageColor}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragTo(event); }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragTo(event); }}
            >
              <AspectRatio ratio={FRAME_RATIO} animated={false} className={styles.stagePane} contentClassName={STAGE_CONTENT} style={stageColor}>
                {backdrop}
                {drawingContent}
                {shown ? (
                  <div className={styles.sliderVideo} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                    <StageImage src={shown.source} alt="Video frame" />
                  </div>
                ) : null}
                <span className={styles.sliderTag} data-side="left" aria-hidden>Video</span>
                <span className={styles.sliderTag} data-side="right" aria-hidden>Drawing</span>
                <div className={styles.sliderLine} style={{ left: `${split}%` }} aria-hidden />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Video and drawing divider"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(split)}
                  aria-valuetext={`${Math.round(split)}% video`}
                  className={styles.sliderHandle}
                  style={{ left: `${split}%` }}
                  onKeyDown={onDividerKey}
                >
                  <HugeiconsIcon icon={ArrowLeftRightIcon} size={14} strokeWidth={1.75} />
                </div>
              </AspectRatio>
            </div>
          ) : null}
          {view !== "slider" ? (
            <div className={fb.stage} data-transparent={background === "checker" ? "" : undefined} style={stageColor}>
              <AspectRatio ratio={FRAME_RATIO} animated={false} className={styles.stagePane} contentClassName={STAGE_CONTENT} style={stageColor}>
                {backdrop}
                {drawingContent}
              </AspectRatio>
            </div>
          ) : null}
        </div>
      </div>

      <div className={fb.transport}>
        <div className={fb.transportGroup}>
          <Button size="icon-sm" variant="ghost" aria-label="Restart" title="Restart" onClick={() => { setPosition(0); if (frames[0]) onSelect(frames[0].index); }} disabled={!frames.length}><HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.75} /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Previous drawing" title="Previous drawing" onClick={() => step(-1)} disabled={!frames.length}><HugeiconsIcon icon={PreviousIcon} size={16} strokeWidth={1.75} /></Button>
          <Button size="icon-sm" variant="secondary" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={() => { if (!playing && !loop && current === frames.length - 1) setPosition(0); setPlaying((value) => !value); }} disabled={frames.length < 2}>
            <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={16} strokeWidth={1.75} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next drawing" title="Next drawing" onClick={() => step(1)} disabled={!frames.length}><HugeiconsIcon icon={NextIcon} size={16} strokeWidth={1.75} /></Button>
          <output className={`${fb.readout} ${styles.readout}`} aria-live={playing ? "off" : "polite"}>
            {showLive ? `Drawing frame ${live.index}` : still ? `Frame ${still.index}${still.drawing ? " · last attempt" : " · not drawn"}` : frame ? `${current + 1}/${frames.length} · ${((frame.index - 1) / fps).toFixed(2)} s` : "—"}
          </output>
        </div>
        <div className={fb.transportGroup}>
          <span title={`${Number(rate.toFixed(2))} drawings per second · ${Math.round(1000 / rate)} ms each`}>
            <Select
              value={String(speed)}
              onValueChange={(value) => setSpeed(Number(value))}
              options={SPEED_PRESETS.map((preset) => ({ value: String(preset), label: `${preset}×` }))}
              aria-label="Preview speed"
              className="h-8 w-[88px] gap-1 pl-2.5 pr-2 text-xs tabular-nums"
              container={fullscreen ? root.current : null}
            />
          </span>
          <PlayerToggle on={loop} onChange={setLoop} icon={RepeatIcon} label="Loop" />
          <PlayerToggle
            on={sound && audioSrc !== null}
            onChange={onSoundChange}
            disabled={audioSrc === null}
            icon={sound && audioSrc !== null ? VolumeHighIcon : VolumeOffIcon}
            label={audioSrc === null ? "This video has no sound" : "Sound: the reference video’s audio, also brought into Flipbook"}
          />
          <PlayerToggle on={smoother} onChange={toggleSmoother} icon={BlurIcon} label="Smoother: each drawing dissolves out of the previous one while playing" />
          {canFullscreen ? (
            <Button size="icon-sm" variant="ghost" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => void toggleFullscreen()}>
              <HugeiconsIcon icon={fullscreen ? MinimizeScreenIcon : MaximizeScreenIcon} size={16} strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      </div>

      {strip}

      <div className={styles.displayBar}>
        <div role="group" aria-label="View">
          <SlidingTabs
            className={styles.playerTabs}
            tabs={VIEWS.map(({ value, label }) => ({ id: value, label }))}
            value={view}
            onValueChange={(id) => setView(id as PlayerView)}
          />
        </div>
        <div className={styles.swatches} role="group" aria-label="Background">
          <button type="button" className={styles.swatch} data-kind="checker" aria-pressed={background === "checker"} aria-label="Transparent background" title="Transparent" onClick={() => setBackground("checker")} />
          <span className={styles.swatchRing} data-selected={background === "color" || undefined} title="Color" onClickCapture={() => setBackground("color")}>
            <ColorPicker value={color} onChange={(next) => { setColor(next); setBackground("color"); }} label="Background color" className="size-6 rounded-full" container={fullscreen ? root.current : null} />
          </span>
          {backdrops ? (
            <DropdownMenu.Root modal={false} onOpenChange={(open) => { if (open) setBackground("plate"); }}>
              <DropdownMenu.Trigger className={styles.swatch} data-kind="plate" data-selected={background === "plate" || undefined} aria-label="Video background" title="Video">
                {making ? <Spinner className="size-3" /> : backdrops.plate ? <MediaImage src={backdrops.plate} alt="" aria-hidden draggable={false} /> : <HugeiconsIcon icon={Image01Icon} size={13} strokeWidth={1.75} />}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={fullscreen ? root.current : undefined}>
                <DropdownMenu.Content align="end" sideOffset={6} className="t-dropdown z-50 w-60 rounded-xl border border-border bg-card p-1 shadow-xl">
                  <div className="px-2.5 py-2">
                    <p className="text-sm font-medium text-foreground">Video background</p>
                    <p className="text-xs text-muted-foreground">The video’s own room behind the drawings, the person taken out. One Muse Image picture for the whole run.</p>
                  </div>
                  {onMakeBackdrop ? (
                    <>
                      <DropdownMenu.Separator className="my-1 h-px bg-border" />
                      <DropdownMenu.Item
                        disabled={making !== null}
                        onSelect={() => void makeBackdrop("plate")}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                      >
                        {making ? <Spinner className="size-3" /> : null}
                        {making ? "Cloning the background…" : backdrops.plate ? "Make again" : "Clone from the video"}
                      </DropdownMenu.Item>
                    </>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** An icon button that stays pressed while its setting is on. */
function PlayerToggle({ on, onChange, icon, label, disabled = false }: {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
  readonly icon: typeof RepeatIcon;
  readonly label: string;
  readonly disabled?: boolean;
}) {
  return (
    <Button size="icon-sm" variant={on ? "secondary" : "ghost"} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}>
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.75} />
    </Button>
  );
}

/**
 * A picture on the stage that never blinks: a new src is decoded off screen
 * and swapped in only once it can paint, so the previous frame stays up until
 * then. (MediaImage fades every new src in from nothing, which at 9 fps reads
 * as flicker.)
 */
function StageImage({ src, alt }: { readonly src: string; readonly alt: string }) {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (src === shown) return;
    let live = true;
    const next = new Image();
    next.src = src;
    // A picture that can't be decoded is still swapped in, so the stage never keeps a stale frame.
    void next.decode().catch(() => undefined).then(() => { if (live) setShown(src); });
    return () => { live = false; };
  }, [src, shown]);
  // eslint-disable-next-line @next/next/no-img-element -- run media from the API, swapped by hand
  return <img src={shown} alt={alt} draggable={false} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} onLoad={(event) => { event.currentTarget.style.visibility = ""; }} />;
}

/**
 * One drawing during playback with Smoother on: at each change the outgoing
 * drawing is mixed in and fades out over most of the new drawing's time.
 * Premultiplied samples are added ("lighter") on a cleared canvas, as
 * Flipbook's light smoothing does, so overlapping transparent drawings
 * don't dim each other.
 */
function SmoothDrawing({ src, duration }: { readonly src: string; readonly duration: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const previous = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext("2d");
    if (!target || !context) return;
    const image = new Image();
    image.src = src;
    let frame = 0;
    const from = previous.current;
    const start = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (target.width !== width || target.height !== height) { target.width = width; target.height = height; }
      const began = performance.now();
      const window = Math.max(16, duration * SMOOTHER.share);
      const paint = (now: number) => {
        const t = Math.min(1, (now - began) / window);
        const weight = from ? SMOOTHER.strength * (1 - t * t * (3 - 2 * t)) : 0;
        context.clearRect(0, 0, width, height);
        if (from && weight > 0.002) {
          context.globalAlpha = 1 - weight;
          context.drawImage(image, 0, 0, width, height);
          context.globalCompositeOperation = "lighter";
          context.globalAlpha = weight;
          context.drawImage(from, 0, 0, width, height);
          context.globalAlpha = 1;
          context.globalCompositeOperation = "source-over";
        } else context.drawImage(image, 0, 0, width, height);
        if (t < 1) frame = requestAnimationFrame(paint);
      };
      frame = requestAnimationFrame(paint);
      previous.current = image;
    };
    if (image.complete && image.naturalWidth) start();
    else image.onload = start;
    return () => { cancelAnimationFrame(frame); image.onload = null; };
  }, [src, duration]);
  return <canvas ref={canvas} role="img" aria-label="Drawing" />;
}
