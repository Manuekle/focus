"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import {
  DRAWING_RATES,
  SPEED_BOUNDS,
  cellLeftAt,
  stageSize,
  tickCount,
  type Cell,
  type PlaybackSettings,
} from "../../shared/flipbook";
import styles from "./flipbook.module.css";

export type PlayerFrame = { readonly id: string; readonly label: string; readonly src: string | null };
export type PlayerBackground = { readonly kind: "transparent" } | { readonly kind: "color"; readonly color: string } | { readonly kind: "image"; readonly src: string };

const RATES = [0.5, 1, 2] as const;
const mod = (value: number, size: number) => ((value % size) + size) % size;

/**
 * The flipbook player. It shows the real drawings, one at a time, each for
 * exactly 1/fps of a second (scaled by the preview speed), at the position
 * the exporter will use: both read shared/flipbook.ts. Time runs on
 * requestAnimationFrame against a fixed start, so a slow frame never makes
 * the cycle drift; React only re-renders when the shown drawing changes.
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
  strip,
  onSelect,
}: {
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
  /** The frame strip, placed right under the transport so it stays in view. */
  readonly strip?: ReactNode;
  readonly onSelect: (index: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const tickRef = useRef(selectedIndex);
  const [tick, setTick] = useState(selectedIndex);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [onion, setOnion] = useState(false);
  const [onionOpacity, setOnionOpacity] = useState(0.35);
  const [onionNext, setOnionNext] = useState(true);

  const count = frames.length;
  const stage = stageSize(settings.motion, cell);
  const total = tickCount(settings.durationSeconds, settings.drawingFps);
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
    }
    return image.complete && image.naturalWidth ? image : null;
  }, []);

  const draw = useCallback((at: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !count) return;
    const again = () => draw(tickRef.current);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (background.kind === "color") {
      context.fillStyle = background.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else if (background.kind === "image") {
      const plate = imageFor(background.src, again);
      if (plate) {
        // Cover-fit, the same as the exporter.
        const scale = Math.max(canvas.width / plate.naturalWidth, canvas.height / plate.naturalHeight);
        const width = plate.naturalWidth * scale;
        const height = plate.naturalHeight * scale;
        context.drawImage(plate, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      }
    }
    const index = mod(at, count);
    const left = cellLeftAt(at, settings, cell, count);
    if (onion && count > 1) {
      context.globalAlpha = onionOpacity;
      const previous = imageFor(frames[mod(index - 1, count)].src, again);
      if (previous) context.drawImage(previous, left, 0, cell.width, cell.height);
      if (onionNext) {
        const next = imageFor(frames[mod(index + 1, count)].src, again);
        if (next) context.drawImage(next, left, 0, cell.width, cell.height);
      }
      context.globalAlpha = 1;
    }
    const current = imageFor(frames[index].src, again);
    if (current) context.drawImage(current, left, 0, cell.width, cell.height);
  }, [background, cell, count, frames, imageFor, onion, onionNext, onionOpacity, settings]);

  // Preload every drawing of the cycle (eight images), nothing else.
  useEffect(() => {
    const wanted = new Set(frames.map((frame) => frame.src).filter((src): src is string => Boolean(src)));
    if (background.kind === "image") wanted.add(background.src);
    for (const src of [...images.current.keys()]) if (!wanted.has(src)) images.current.delete(src);
    for (const src of wanted) imageFor(src, () => draw(tickRef.current));
  }, [frames, background, imageFor, draw]);

  useEffect(() => {
    draw(tickRef.current);
  }, [draw, stage.width, stage.height]);

  // The player owns the current tick. Effects read the latest draw, count and
  // parent callbacks through refs, so a parent re-render (new prop objects)
  // never restarts playback, pauses it, or bounces the selection back and forth.
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const countRef = useRef(count);
  countRef.current = count;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;

  const seek = useCallback((next: number) => {
    tickRef.current = next;
    setTick(next);
    drawRef.current(next);
  }, []);

  // A frame picked in the strip (each pick bumps the nonce): pause there. Only the nonce triggers it.
  useEffect(() => {
    const size = countRef.current;
    if (!seekNonce || !size) return;
    setPlaying(false);
    if (mod(tickRef.current, size) !== selectedRef.current) seek(selectedRef.current);
  }, [seekNonce, seek]);

  useEffect(() => {
    if (!playing || !count) return;
    const started = performance.now();
    const from = !loop && tickRef.current >= total - 1 ? 0 : tickRef.current;
    let raf = 0;
    const step = (now: number) => {
      const next = from + Math.floor(((now - started) * rate * settings.drawingFps) / 1000);
      if (!loop && next >= total - 1) {
        seek(total - 1);
        setPlaying(false);
        return;
      }
      if (next !== tickRef.current) seek(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, rate, settings.drawingFps, count, total, seek]);

  // Paused on a drawing: the strip and the frame panel follow it, once per change.
  useEffect(() => {
    if (playing || !count) return;
    const index = mod(tick, count);
    if (index !== selectedRef.current) onSelectRef.current(index);
  }, [playing, tick, count]);

  // Autoplay once the whole cycle exists, unless the person asked for less motion.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (ready && !autoplayed.current && !reducedMotion) {
      autoplayed.current = true;
      setPlaying(true);
    }
  }, [ready, reducedMotion]);

  const stepBy = (delta: number) => {
    setPlaying(false);
    seek(loop ? tickRef.current + delta : Math.max(0, Math.min(total - 1, tickRef.current + delta)));
  };
  const restart = () => {
    seek(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " || event.key === "k") { event.preventDefault(); setPlaying((value) => !value); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); stepBy(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); stepBy(1); }
    else if (event.key === "Home") { event.preventDefault(); restart(); }
  };

  const index = count ? mod(tick, count) : 0;
  const current = frames[index];

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
            <HugeiconsIcon icon={RepeatIcon} size={13} strokeWidth={1.75} />Loop
          </ToggleChip>
        </div>
        <output className={styles.readout} aria-live={playing ? "off" : "polite"}>
          {count ? `${index + 1}/${count} · ${current?.label ?? ""}` : "—"}
        </output>
      </div>

      {strip}

      <div className={styles.controlsGrid}>
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Drawings per second</span>
          <div className={styles.chips}>
            {DRAWING_RATES.map((fps) => (
              <ToggleChip key={fps} size="xs" selected={settings.drawingFps === fps} onClick={() => onSettingsChange({ ...settings, drawingFps: fps })}>{fps}</ToggleChip>
            ))}
          </div>
        </div>
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
          <label className={styles.controlRow}>
            <span className={styles.controlLabel}>Travel speed <span className="tabular-nums">{settings.speed.toFixed(2)}×</span></span>
            <input
              type="range"
              min={SPEED_BOUNDS[0]}
              max={SPEED_BOUNDS[1]}
              step={0.05}
              value={settings.speed}
              onChange={(event) => onSettingsChange({ ...settings, speed: Number(event.currentTarget.value) })}
              className="editor-scrubber w-40"
              style={{ "--scrub": `${((settings.speed - SPEED_BOUNDS[0]) / (SPEED_BOUNDS[1] - SPEED_BOUNDS[0])) * 100}%` } as CSSProperties}
              aria-valuetext={`${settings.speed.toFixed(2)} times the measured stride`}
            />
          </label>
        ) : null}
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Onion skin</span>
          <div className={styles.chips}>
            <Switch checked={onion} onCheckedChange={setOnion} label="Onion skin" />
            {onion ? (
              <>
                <input
                  type="range" min={0.1} max={0.7} step={0.05} value={onionOpacity}
                  onChange={(event) => setOnionOpacity(Number(event.currentTarget.value))}
                  className="editor-scrubber w-24"
                  style={{ "--scrub": `${((onionOpacity - 0.1) / 0.6) * 100}%` } as CSSProperties}
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
