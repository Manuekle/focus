"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, Refresh01Icon, RepeatIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { AspectRatio, AspectRatioImage } from "../../components/motion/aspect-ratio";
import { Button } from "../../components/ui/button";
import { MediaImage } from "../../components/ui/media-image";
import { Skeleton } from "../../components/ui/skeleton";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { FRAME_RATIO, FRAME_SIZE } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import styles from "./rotoscope.module.css";

/** Preset speeds; the slider covers everything between them in 0.05× steps. */
export const SPEED_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export const SPEED_RANGE = { min: 0.1, max: 4, step: 0.05 } as const;

export type PlayerBackground = "checker" | "white" | "dark";
export type PlayerView = "compare" | "drawing";
export type PlayerFrame = { readonly index: number; readonly drawing: string; readonly source: string };

/** Smoother: how much of the outgoing drawing is mixed in at a cut, and over what share of the drawing's time it fades. */
const SMOOTHER = { strength: 0.5, share: 0.75 } as const;
/** Centres the empty-state and live-label text in the frame's content layer. */
const STAGE_CONTENT = "grid place-items-center";
const SMOOTHER_KEY = "focus.rotoscope.smoother";

/** What the stage shows while a frame is being drawn: the video frame, and the attempt once it exists. */
export type LiveStage = { readonly index: number; readonly source: string; readonly drawing: string | null; readonly label: string };

/**
 * The preview, as in Flipbook: approved drawings play at the run's frame
 * rate times 0.1× to 4×, beside their video frames or alone. While a run
 * draws, the stage follows the frame in progress instead.
 */
export function RotoscopePlayer({ frames, fps, live, focus, onSelect, strip, compact = false, audioSrc, sound, onSoundChange }: {
  readonly frames: readonly PlayerFrame[];
  readonly fps: number;
  readonly live: LiveStage | null;
  /** The frame selected in the strip: shown when paused, drawn or not. */
  readonly focus: { readonly index: number; readonly source: string; readonly drawing: string | null } | null;
  readonly onSelect: (index: number) => void;
  readonly strip: ReactNode;
  /** A shorter stage, for the drawer over the canvas. */
  readonly compact?: boolean;
  /** The reference video's sound from the run's start; null when the video has none. */
  readonly audioSrc: string | null;
  readonly sound: boolean;
  readonly onSoundChange: (on: boolean) => void;
}) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [view, setView] = useState<PlayerView>("compare");
  const [background, setBackground] = useState<PlayerBackground>("checker");
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
  const shown = showLive ? { source: live.source, drawing: live.drawing } : still ?? (frame ? { source: frame.source, drawing: frame.drawing } : null);
  const panes = view === "compare" ? 2 : 1;

  return (
    <div className={fb.player}>
      <div className={compact ? `${fb.lightTable} ${styles.compactTable}` : fb.lightTable}>
        <div className={styles.stagePair} style={{ "--panes": panes, ...(compact ? { "--stage-height": "min(44vh, 420px)" } : {}) } as CSSProperties}>
          {view === "compare" ? (
            <div className={fb.stage} data-transparent="">
              <AspectRatio ratio={FRAME_RATIO} animated={false} className={styles.stagePane} contentClassName={STAGE_CONTENT}>
                {shown ? (
                  <MediaImage src={shown.source} alt="Video frame" />
                ) : <span className={fb.stageEmpty}>No frames yet</span>}
              </AspectRatio>
            </div>
          ) : null}
          <div className={fb.stage} data-transparent={background === "checker" ? "" : undefined} data-background={background}>
            <AspectRatio ratio={FRAME_RATIO} animated={false} className={styles.stagePane} contentClassName={STAGE_CONTENT} data-background={background}>
              {shown?.drawing && smoother && playing && !showLive && !still ? (
                <SmoothDrawing src={shown.drawing} duration={1000 / rate} />
              ) : shown?.drawing ? (
                <AspectRatioImage src={shown.drawing} alt="Drawing" width={FRAME_SIZE.width} height={FRAME_SIZE.height} />
              ) : showLive ? (
                <>
                  <Skeleton className={fb.working} />
                  <span className={fb.workingLabel}>{live.label}</span>
                </>
              ) : <span className={fb.stageEmpty}>{still ? "Not drawn yet" : "No approved drawing yet"}</span>}
            </AspectRatio>
          </div>
        </div>
      </div>

      <div className={fb.transport}>
        <div className={fb.transportGroup}>
          <Button size="icon-sm" variant="ghost" aria-label="Restart" onClick={() => { setPosition(0); if (frames[0]) onSelect(frames[0].index); }} disabled={!frames.length}><HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.75} /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Previous drawing" onClick={() => step(-1)} disabled={!frames.length}><HugeiconsIcon icon={PreviousIcon} size={16} strokeWidth={1.75} /></Button>
          <Button size="icon-sm" variant="secondary" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={() => { if (!playing && !loop && current === frames.length - 1) setPosition(0); setPlaying((value) => !value); }} disabled={frames.length < 2}>
            <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={16} strokeWidth={1.75} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next drawing" onClick={() => step(1)} disabled={!frames.length}><HugeiconsIcon icon={NextIcon} size={16} strokeWidth={1.75} /></Button>
          <ToggleChip selected={loop} size="xs" onClick={() => setLoop((value) => !value)} aria-label="Loop">
            <HugeiconsIcon icon={RepeatIcon} size={13} strokeWidth={1.75} />Loop
          </ToggleChip>
        </div>
        <output className={fb.readout} aria-live={playing ? "off" : "polite"}>
          {showLive ? `Drawing frame ${live.index}` : still ? `Frame ${still.index}${still.drawing ? " · last attempt" : " · not drawn"}` : frame ? `${current + 1}/${frames.length} · ${((frame.index - 1) / fps).toFixed(2)} s` : "—"}
        </output>
      </div>

      {strip}

      <div className={fb.controlsGrid}>
        <div className={styles.speedRow}>
          <div className={fb.controlHeading}>
            <span className={fb.controlLabel}>Preview speed</span>
            <span className={fb.controlValue}>{speed.toFixed(2)}× · {Number(rate.toFixed(2))} fps · {Math.round(1000 / rate)} ms per drawing</span>
          </div>
          <Slider min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={SPEED_RANGE.step} value={[speed]} onValueChange={([value]) => setSpeed(Math.round(value * 100) / 100)} aria-label="Preview speed" aria-valuetext={`${speed.toFixed(2)} times, ${rate.toFixed(1)} drawings per second`} />
          <div className={fb.chips} role="group" aria-label="Speed presets">
            {SPEED_PRESETS.map((preset) => <ToggleChip key={preset} size="xs" selected={speed === preset} onClick={() => setSpeed(preset)}>{preset}×</ToggleChip>)}
          </div>
        </div>
        <div className={fb.controlRow} role="group" aria-label="View">
          <span className={fb.controlLabel}>View</span>
          <ToggleChip size="xs" selected={view === "compare"} onClick={() => setView("compare")}>Video | drawing</ToggleChip>
          <ToggleChip size="xs" selected={view === "drawing"} onClick={() => setView("drawing")}>Drawing</ToggleChip>
        </div>
        <div className={fb.controlRow} role="group" aria-label="Background">
          <span className={fb.controlLabel}>Background</span>
          {(["checker", "white", "dark"] as const).map((value) => (
            <ToggleChip key={value} size="xs" selected={background === value} onClick={() => setBackground(value)}>{value === "checker" ? "Transparent" : value === "white" ? "White" : "Dark"}</ToggleChip>
          ))}
        </div>
        <div className={fb.controlRow}>
          <span className={fb.controlLabel} title={audioSrc ? "Plays the reference video’s sound in sync with the preview, and brings it into Flipbook." : "This video has no sound track."}>Sound</span>
          <Switch checked={sound && audioSrc !== null} disabled={audioSrc === null} onCheckedChange={onSoundChange} label="Sound: play the reference video’s audio with the preview" />
          {audioSrc === null ? <span className={fb.controlValue}>No sound in this video</span> : null}
        </div>
        <div className={fb.controlRow}>
          <span className={fb.controlLabel} title="While playing, each drawing dissolves out of the previous one instead of cutting.">Smoother</span>
          <Switch checked={smoother} onCheckedChange={toggleSmoother} label="Smoother: dissolve between drawings while playing" />
        </div>
      </div>
    </div>
  );
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
