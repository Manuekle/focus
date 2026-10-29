"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, Exchange01Icon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Slider } from "../../components/ui/slider";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import {
  EXPOSURE_FPS,
  OUTPUT_FPS,
  PARALLAX_FAR,
  ZOOM_DEPTH,
  SPEED_BOUNDS,
  backgroundShiftAt,
  backgroundImageRect,
  backgroundZoomAt,
  cellLeftAt,
  cellTopAt,
  drawingAtOutputFrame,
  playbackClock,
  poseSmoothingAt,
  exposureSheet,
  outputFrameAtTick,
  outputFrameCount,
  stageSize,
  type Cell,
  type BackgroundFit,
  type FlipbookDirection,
  type PlaybackSettings,
} from "../../shared/flipbook";
import styles from "./flipbook.module.css";
import type { FlipbookAudio } from "../../shared/sequence";
import { useTimelineAudio } from "./use-timeline-audio";

/** A drawing of the cycle: a key pose, or an in-between after the key before it. */
export type PlayerFrame = { readonly id: string; readonly label: string; readonly phase: string; readonly src: string | null; readonly inbetween?: boolean; readonly position?: number };
export type PlayerBackground =
  | { readonly kind: "transparent" }
  | { readonly kind: "color"; readonly color: string }
  | { readonly kind: "image"; readonly src: string; readonly fit?: BackgroundFit }
  /** A repeating strip that slides behind the cycle. */
  | { readonly kind: "scroll"; readonly src: string }
  /** Two repeating strips: the far one (the sky) slides slower than the near one. */
  | { readonly kind: "parallax"; readonly far: string; readonly near: string }
  /** One picture, slowly zooming in and back out over the length. */
  | { readonly kind: "zoom"; readonly src: string; readonly fit?: BackgroundFit };

const RATES = [0.5, 1, 2] as const;
const mod = (value: number, size: number) => ((value % size) + size) % size;

/**
 * The flipbook player. It runs the exporter's 60 fps clock: each drawing
 * stays on screen for its exposure-sheet frames (anime timing, a 24 fps
 * exposure clock), while a moving background and travelling character move
 * on every frame, at the positions the exporter uses (both read
 * shared/flipbook.ts). Optional light smoothing fades a small fraction of
 * the previous pose for at most 33 ms. Time runs on
 * requestAnimationFrame against a fixed start, so a slow frame never makes
 * the cycle drift; the canvas redraws once per output frame and React only
 * re-renders when the shown drawing changes.
 */
export function SequencePlayer({
  frames,
  cell,
  settings,
  onSettingsChange,
  background,
  selectedIndex,
  seekNonce,
  strideMeasured,
  travel,
  facing,
  strip,
  onSelect,
  inbetweenCount = 0,
  fixedPace = false,
  finite = false,
  audio,
  audioUrl,
}: {
  /** The played cycle, in-betweens included. `selectedIndex` and `onSelect` count key drawings only. */
  readonly frames: readonly PlayerFrame[];
  readonly cell: Cell;
  readonly settings: PlaybackSettings;
  readonly onSettingsChange: (settings: PlaybackSettings) => void;
  readonly background: PlayerBackground;
  readonly selectedIndex: number;
  /** Changes whenever the person picks a frame elsewhere: the player pauses on it. */
  readonly seekNonce: number;
  readonly strideMeasured: boolean;
  /** Whether this action can move across the stage, and the verb for it ("Walk", "Run"). */
  readonly travel: { readonly verb: string } | null;
  /** Which way the character faces: a scrolling background slides against it. */
  readonly facing: FlipbookDirection;
  /** The frame strip, placed right under the transport so it stays in view. */
  readonly strip?: ReactNode;
  readonly onSelect: (index: number) => void;
  /** Current in-betweens: when there are any, a switch plays them or leaves them out. */
  readonly inbetweenCount?: number;
  /** A scene is drawn at one pace: there is no drawings-per-second choice. */
  readonly fixedPace?: boolean;
  readonly finite?: boolean;
  readonly audio?: FlipbookAudio;
  readonly audioUrl?: string;
}) {
  const reducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothingCanvas = useRef<HTMLCanvasElement | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  // The drawings that play at this pace, and how long each holds.
  const { drawings, holds } = useMemo(() => exposureSheet(frames, settings.drawingFps, settings.cycleSeconds), [frames, settings.drawingFps, settings.cycleSeconds]);
  // Key position of each shown drawing (an in-between counts as the key before it), and back.
  const keyIndex = useMemo(() => {
    let key = -1;
    return drawings.map((drawing) => (drawing.inbetween ? Math.max(0, key) : ++key));
  }, [drawings]);
  const drawingOfKey = useCallback((key: number) => Math.max(0, keyIndex.findIndex((value, index) => value === key && !drawings[index].inbetween)), [keyIndex, drawings]);
  const frameRef = useRef(outputFrameAtTick(drawingOfKey(selectedIndex), holds));
  const tickRef = useRef(drawingOfKey(selectedIndex));
  const [tick, setTick] = useState(() => drawingOfKey(selectedIndex));
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(!finite);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const syncAudio = useTimelineAudio(audio, audioUrl, playing, rate, audioEnabled, settings.durationSeconds);
  const [onion, setOnion] = useState(false);
  const [onionOpacity, setOnionOpacity] = useState(0.35);
  const [onionNext, setOnionNext] = useState(true);

  const count = drawings.length;
  const keyCount = drawings.filter((drawing) => !drawing.inbetween).length;
  const cycleSeconds = holds.reduce((sum, hold) => sum + hold, 0) / EXPOSURE_FPS;
  const drawingRate = cycleSeconds > 0 ? count / cycleSeconds : 0;
  const stage = stageSize(settings, cell);
  const total = outputFrameCount(settings.durationSeconds);
  const ticks = count ? drawingAtOutputFrame(total - 1, holds).tick + 1 : 0;
  const ready = count > 0 && frames.every((frame) => frame.src);

  const imageFor = useCallback((src: string | null, redraw: () => void) => {
    if (!src) return null;
    let image = images.current.get(src);
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.onload = redraw;
      image.src = src;
      images.current.set(src, image);
      if (images.current.size > 12) {
        const oldest = images.current.keys().next().value;
        if (oldest) { const previous = images.current.get(oldest); if (previous) previous.onload = null; images.current.delete(oldest); }
      }
    } else {
      images.current.delete(src);
      images.current.set(src, image);
    }
    return image.complete && image.naturalWidth ? image : null;
  }, []);

  const draw = useCallback((frame: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !count) return;
    const again = () => draw(frameRef.current);
    const { index, previousIndex, previousWeight } = poseSmoothingAt(frame, holds, settings.smoothing);
    const current = imageFor(drawings[index].src, again);
    // A decode/network delay must hold the last painted pose, never flash an empty stage.
    if (drawings[index].src && !current) return;
    const clock = playbackClock(frame, settings, keyCount);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (background.kind === "color") {
      context.fillStyle = background.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else if (background.kind === "image") {
      const plate = imageFor(background.src, again);
      if (plate) {
        const rect = backgroundImageRect(canvas, { width: plate.naturalWidth, height: plate.naturalHeight }, background.fit);
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(plate, rect.left, rect.top, rect.width, rect.height);
      }
    } else if (background.kind === "scroll" || background.kind === "parallax") {
      // Fitted to the stage height and wrapped, the same as the exporter.
      const shift = backgroundShiftAt(clock, settings, cell, keyCount, facing);
      const strip = (src: string, by: number) => {
        const plate = imageFor(src, again);
        if (!plate) return;
        const width = Math.round((plate.naturalWidth * canvas.height) / plate.naturalHeight);
        for (let x = -mod(by, width); x < canvas.width; x += width) context.drawImage(plate, x, 0, width, canvas.height);
      };
      if (background.kind === "scroll") strip(background.src, shift);
      else {
        strip(background.far, Math.round(shift * PARALLAX_FAR));
        strip(background.near, shift);
      }
    } else if (background.kind === "zoom") {
      const plate = imageFor(background.src, again);
      if (plate) {
        const zoom = backgroundZoomAt(clock, settings, keyCount);
        const rect = backgroundImageRect(canvas, { width: plate.naturalWidth, height: plate.naturalHeight }, background.fit, background.fit === "cover" ? zoom : zoom / (1 + ZOOM_DEPTH));
        context.fillStyle = "#000000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(plate, rect.left, rect.top, rect.width, rect.height);
      }
    }
    const left = cellLeftAt(clock, settings, cell, keyCount);
    const top = cellTopAt(settings, cell);
    if (onion && count > 1) {
      context.globalAlpha = onionOpacity;
      const previous = imageFor(drawings[finite ? Math.max(0, index - 1) : mod(index - 1, count)].src, again);
      if (previous) context.drawImage(previous, left, top, cell.width, cell.height);
      if (onionNext) {
        const next = imageFor(drawings[finite ? Math.min(count - 1, index + 1) : mod(index + 1, count)].src, again);
        if (next) context.drawImage(next, left, top, cell.width, cell.height);
      }
      context.globalAlpha = 1;
    }
    const previous = previousWeight > 0 ? imageFor(drawings[previousIndex].src, again) : null;
    if (current && previous) {
      const layer = smoothingCanvas.current ?? (smoothingCanvas.current = document.createElement("canvas"));
      if (layer.width !== cell.width || layer.height !== cell.height) { layer.width = cell.width; layer.height = cell.height; }
      const mix = layer.getContext("2d")!;
      mix.clearRect(0, 0, cell.width, cell.height);
      // Add premultiplied samples, then composite the result once. Drawing
      // two translucent sprites with source-over would dim their overlap.
      mix.globalAlpha = 1 - previousWeight;
      mix.drawImage(current, 0, 0, cell.width, cell.height);
      mix.globalCompositeOperation = "lighter";
      mix.globalAlpha = previousWeight;
      mix.drawImage(previous, 0, 0, cell.width, cell.height);
      mix.globalAlpha = 1;
      mix.globalCompositeOperation = "source-over";
      context.drawImage(layer, left, top);
    } else if (current) context.drawImage(current, left, top, cell.width, cell.height);
  }, [background, cell, count, drawings, facing, finite, holds, imageFor, keyCount, onion, onionNext, onionOpacity, settings]);

  // Preload the drawings and selected background.
  useEffect(() => {
    const index = count ? drawingAtOutputFrame(frameRef.current, holds).index : 0;
    const wanted = new Set(drawings.slice(Math.max(0, index - 2), index + 7).map((frame) => frame.src).filter((src): src is string => Boolean(src)));
    if (background.kind === "image" || background.kind === "scroll" || background.kind === "zoom") wanted.add(background.src);
    if (background.kind === "parallax") { wanted.add(background.far); wanted.add(background.near); }
    for (const src of [...images.current.keys()]) if (!wanted.has(src)) images.current.delete(src);
    for (const src of wanted) imageFor(src, () => draw(frameRef.current));
  }, [drawings, count, holds, tick, background, imageFor, draw]);

  useEffect(() => {
    draw(frameRef.current);
  }, [draw, stage.width, stage.height]);

  // The player owns the current frame. Effects read the latest draw, timing
  // and parent callbacks through refs, so a parent re-render (new prop
  // objects) never restarts playback, pauses it, or bounces the selection.
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const holdsRef = useRef(holds);
  holdsRef.current = holds;
  const countRef = useRef(count);
  countRef.current = count;
  const keyIndexRef = useRef(keyIndex);
  keyIndexRef.current = keyIndex;
  const drawingOfKeyRef = useRef(drawingOfKey);
  drawingOfKeyRef.current = drawingOfKey;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;

  // Bumped by a restart: the running playback re-bases its clock on it, or
  // its next frame would put the old timeline back.
  const clockRef = useRef(0);

  const seek = useCallback((frame: number) => {
    frameRef.current = frame;
    syncAudio(frame / OUTPUT_FPS);
    drawRef.current(frame);
    const next = drawingAtOutputFrame(frame, holdsRef.current).tick;
    if (next !== tickRef.current) {
      tickRef.current = next;
      setTick(next);
    }
  }, [syncAudio]);

  // A frame picked in the strip (each pick bumps the nonce): pause on it. Only the nonce triggers it.
  useEffect(() => {
    const size = countRef.current;
    if (!seekNonce || !size) return;
    setPlaying(false);
    const target = drawingOfKeyRef.current(selectedRef.current);
    if (mod(tickRef.current, size) !== target) seek(outputFrameAtTick(target, holdsRef.current));
  }, [seekNonce, seek]);

  useEffect(() => {
    if (!playing || !count) return;
    let started = performance.now();
    let from = !loop && frameRef.current >= total - 1 ? 0 : frameRef.current;
    let clock = clockRef.current;
    let raf = 0;
    const step = (now: number) => {
      if (clock !== clockRef.current) {
        clock = clockRef.current;
        started = now;
        from = frameRef.current;
      }
      const next = from + Math.floor(((now - started) * rate * OUTPUT_FPS) / 1000);
      if (!loop && next >= total - 1) {
        seek(total - 1);
        setPlaying(false);
        return;
      }
      if (next !== frameRef.current) seek(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, rate, count, total, seek]);

  // Paused on a drawing: the strip and the frame panel follow its key, once per change.
  useEffect(() => {
    if (playing || !count) return;
    const key = keyIndexRef.current[mod(tick, count)] ?? 0;
    if (key !== selectedRef.current) onSelectRef.current(key);
  }, [playing, tick, count]);

  // Autoplay once the whole cycle exists, unless the person asked for less motion.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (ready && !autoplayed.current && !reducedMotion) {
      autoplayed.current = true;
      setPlaying(true);
    }
  }, [ready, reducedMotion]);

  // Stepping moves one drawing, landing on its first frame.
  const stepBy = (delta: number) => {
    setPlaying(false);
    const from = tickRef.current;
    const next = loop ? mod(from + delta, ticks) : Math.max(0, Math.min(ticks - 1, from + delta));
    seek(outputFrameAtTick(next, holds));
  };
  const restart = () => {
    clockRef.current++;
    seek(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " || event.key === "k") { event.preventDefault(); setPlaying((value) => !value); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); stepBy(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); stepBy(1); }
    else if (event.key === "Home") { event.preventDefault(); restart(); }
  };

  const index = count ? mod(tick, count) : 0;
  const current = drawings[index];

  return (
    <div className={styles.player}>
      <div className={styles.lightTable}>
      <div
        className={styles.stage}
        data-transparent={background.kind === "transparent" || undefined}
        tabIndex={0}
        role="group"
        aria-roledescription="animation player"
        aria-label="Animation preview. Space plays or pauses, arrow keys step one drawing, Home restarts."
        onKeyDown={onKeyDown}
        // Never wider than its aspect allows at the capped height: no dark bands beside the drawing.
        style={{ aspectRatio: `${stage.width} / ${stage.height}`, maxWidth: `calc(min(56vh, 600px) * ${stage.width} / ${stage.height})` }}
      >
        <canvas ref={canvasRef} width={stage.width} height={stage.height} className={styles.canvas} />
        {!current?.src ? <p className={styles.stageEmpty}>{count ? "This drawing isn’t ready yet." : "No frames yet."}</p> : null}
      </div>
      </div>

      <div className={styles.transport}>
        <div className={styles.transportGroup}>
          <Button size="icon-sm" variant="ghost" aria-label="Restart" onClick={restart}><HugeiconsIcon icon={RotateLeft01Icon} size={16} strokeWidth={1.75} /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Previous drawing" onClick={() => stepBy(-1)}><HugeiconsIcon icon={PreviousIcon} size={16} strokeWidth={1.75} /></Button>
          <Button size="icon-sm" variant="secondary" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={() => setPlaying((value) => !value)} disabled={!count}>
            <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={16} strokeWidth={1.75} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next drawing" onClick={() => stepBy(1)}><HugeiconsIcon icon={NextIcon} size={16} strokeWidth={1.75} /></Button>
          <ToggleChip selected={loop} size="xs" onClick={() => setLoop((value) => !value)} aria-label="Loop">
            <HugeiconsIcon icon={Exchange01Icon} size={13} strokeWidth={1.75} />Loop
          </ToggleChip>
        </div>
        <output className={styles.readout} aria-live={playing ? "off" : "polite"}>
          {count ? `${(keyIndex[index] ?? 0) + 1}/${keyCount} · ${current?.label ?? ""}` : "—"}
        </output>
      </div>

      {strip}
      {audio ? <label className={styles.controlRow}><span className={styles.controlLabel}>Preview audio</span><Switch checked={audioEnabled} onCheckedChange={setAudioEnabled} label="Preview audio with the animation" /></label> : null}

      <div className={styles.controlsGrid}>
        {fixedPace ? null : <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Cycle length</span>
          <div className={styles.chips}>
            {[1, 2, 4].map((seconds) => (
              <ToggleChip key={seconds} size="xs" selected={Math.abs(cycleSeconds - seconds) < 1e-6} onClick={() => { restart(); onSettingsChange({ ...settings, cycleSeconds: seconds }); }} aria-label={`Cycle length ${seconds} s`}>{seconds} s</ToggleChip>
            ))}
            <span className={styles.hint}>{count} drawings ÷ {Number(cycleSeconds.toFixed(2))} s = {Number(drawingRate.toFixed(1))} drawings/s</span>
          </div>
        </div>}
        {!finite ? <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Light smoothing</span>
          <Switch checked={(settings.smoothing ?? 0) > 0} onCheckedChange={(checked) => onSettingsChange({ ...settings, smoothing: checked ? 0.12 : 0 })} label="Light smoothing" />
        </div> : null}
        {inbetweenCount > 0 ? (
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>In-betweens</span>
            <div className={styles.chips}>
              <Switch checked={settings.inbetweens !== false} onCheckedChange={(checked) => onSettingsChange({ ...settings, inbetweens: checked })} label="Play in-betweens" />
            </div>
          </div>
        ) : null}
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Preview speed</span>
          <div className={styles.chips}>
            {RATES.map((value) => (
              <ToggleChip key={value} size="xs" selected={rate === value} onClick={() => setRate(value)}>{value}×</ToggleChip>
            ))}
          </div>
        </div>
        {travel ? (
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>Movement</span>
            <div className={styles.chips}>
              {(["in_place", "left", "right"] as const).map((motion) => (
                <ToggleChip key={motion} size="xs" selected={settings.motion === motion} onClick={() => onSettingsChange({ ...settings, motion })}>
                  {motion === "in_place" ? "In place" : `${travel.verb} ${motion}`}
                </ToggleChip>
              ))}
            </div>
          </div>
        ) : null}
        {travel && settings.motion !== "in_place" ? (
          <div className={styles.controlRow}>
            <span className={styles.controlLabel}>Travel speed <span className="tabular-nums">{settings.speed.toFixed(2)}×</span></span>
            <Slider
              min={SPEED_BOUNDS[0]}
              max={SPEED_BOUNDS[1]}
              step={0.05}
              value={[settings.speed]}
              onValueChange={([speed]) => onSettingsChange({ ...settings, speed })}
              className="w-40 max-w-full"
              aria-label="Travel speed"
              aria-valuetext={`${settings.speed.toFixed(2)} times the measured stride`}
            />
          </div>
        ) : null}
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Onion skin</span>
          <div className={styles.chips}>
            <Switch checked={onion} onCheckedChange={setOnion} label="Onion skin" />
            {onion ? (
              <>
                <Slider
                  min={0.1} max={0.7} step={0.05} value={[onionOpacity]}
                  onValueChange={([opacity]) => setOnionOpacity(opacity)}
                  className="w-24"
                  aria-label="Onion skin opacity"
                  aria-valuetext={`${Math.round(onionOpacity * 100)}%`}
                />
                <ToggleChip size="xs" selected={onionNext} onClick={() => setOnionNext((value) => !value)}>Show next</ToggleChip>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {travel && settings.motion !== "in_place" && !strideMeasured ? <p className={styles.hint}>The stride couldn’t be measured from the drawings; travel uses an estimate.</p> : null}
    </div>
  );
}
