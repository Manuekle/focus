"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Alert02Icon, MusicNote01Icon, Tick02Icon, ViewIcon, ViewOffIcon, VolumeHighIcon, VolumeOffIcon, ZoomInIcon, ZoomOutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { EXPOSURE_FPS, OUTPUT_FPS } from "../../shared/flipbook";
import type { FlipbookAudio } from "../../shared/sequence";
import type { PlayerFrame } from "./sequence-player";
import styles from "./frame-timeline.module.css";

const ZOOM = { min: 1, max: 12, step: 0.25 } as const;
/** Below this width a clip shows its number only; above it, its drawing too. */
const THUMB_MIN = 30;
const DRAG_START = 4;

/** `0:02.25`: minutes, seconds and hundredths, as the exporter counts them. */
export function timecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** Ruler marks for a timeline drawn at `pps` pixels a second: whole seconds labelled, finer marks as room allows. */
export function timelineMarks(durationSeconds: number, pps: number): { at: number; major: boolean; label: string | null }[] {
  const step = pps >= 160 ? 0.125 : pps >= 70 ? 0.25 : pps >= 30 ? 0.5 : 1;
  const labelEvery = pps >= 36 ? 1 : pps >= 18 ? 2 : 5;
  const list: { at: number; major: boolean; label: string | null }[] = [];
  for (let at = 0; at <= durationSeconds + 1e-9; at += step) {
    const whole = Math.abs(at - Math.round(at)) < 1e-6;
    list.push({ at, major: whole, label: whole && Math.round(at) % labelEvery === 0 ? `${Math.floor(Math.round(at) / 60)}:${String(Math.round(at) % 60).padStart(2, "0")}` : null });
  }
  return list;
}

type Clip = { readonly key: number; readonly index: number; readonly lap: number; readonly start: number; readonly end: number };

/**
 * The editor's timeline, like a video editor's: a ruler, one track of key
 * drawings (each spans its pose until the next key), one of in-betweens and
 * one of audio, under a playhead that follows the player's clock without
 * re-rendering. Clips past the first cycle are its repeats, drawn dimmer.
 * Click or drag the ruler to scrub, click a clip to select its drawing, drag
 * a key drawing (or Alt + arrow) to reorder it.
 */
export function FrameTimeline({
  drawings,
  holds,
  keyIndex,
  durationSeconds,
  finite,
  selectedKey,
  playing,
  subscribe,
  currentFrame,
  onSeek,
  onPick,
  onMove,
  clipThumb,
  transport,
  tools,
  inbetweenCount,
  inbetweensOn,
  onInbetweensChange,
  audio,
  audioOn,
  onAudioChange,
}: {
  readonly drawings: readonly PlayerFrame[];
  /** Exposure frames each shown drawing holds, on the 24 fps clock. */
  readonly holds: readonly number[];
  /** Key position of each shown drawing; an in-between counts as the key before it. */
  readonly keyIndex: readonly number[];
  readonly durationSeconds: number;
  readonly finite: boolean;
  readonly selectedKey: number;
  readonly playing: boolean;
  /** Called with the output (60 fps) frame on every frame the player shows. */
  readonly subscribe: (listener: (frame: number) => void) => () => void;
  readonly currentFrame: () => number;
  readonly onSeek: (outputFrame: number) => void;
  readonly onPick: (key: number) => void;
  /** Present when key drawings can be reordered. */
  readonly onMove?: (from: number, to: number) => void;
  readonly clipThumb?: (drawing: PlayerFrame) => ReactNode;
  readonly transport: ReactNode;
  readonly tools: ReactNode;
  readonly inbetweenCount: number;
  readonly inbetweensOn: boolean;
  readonly onInbetweensChange: (on: boolean) => void;
  readonly audio?: FlipbookAudio;
  readonly audioOn: boolean;
  readonly onAudioChange: (on: boolean) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const keyList = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ readonly from: number; readonly to: number; readonly dx: number } | null>(null);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element);
    setViewport(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const pps = viewport > 0 ? ((viewport - 24) / durationSeconds) * zoom : 0;
  const width = Math.max(viewport, durationSeconds * pps + 24);
  const x = useCallback((seconds: number) => 12 + seconds * pps, [pps]);

  // Where each shown drawing starts in one cycle, and the cycle's length, in exposure frames.
  const { starts, cycle } = useMemo(() => {
    const at: number[] = [];
    let sum = 0;
    for (const hold of holds) { at.push(sum); sum += hold; }
    return { starts: at, cycle: sum };
  }, [holds]);
  const totalFrames = durationSeconds * EXPOSURE_FPS;
  const laps = cycle > 0 ? (finite ? 1 : Math.ceil(totalFrames / cycle - 1e-9)) : 0;

  // Key drawings span their pose until the next key; in-betweens span their own hold.
  const { keys, middles } = useMemo(() => {
    const keyClips: Clip[] = [];
    const middleClips: Clip[] = [];
    if (!cycle) return { keys: keyClips, middles: middleClips };
    for (let lap = 0; lap < laps; lap++) {
      const offset = lap * cycle;
      for (let index = 0; index < drawings.length; index++) {
        const start = offset + starts[index];
        if (start >= totalFrames) break;
        if (drawings[index].inbetween) {
          middleClips.push({ key: keyIndex[index], index, lap, start, end: Math.min(totalFrames, start + holds[index]) });
          continue;
        }
        let next = index + 1;
        while (next < drawings.length && drawings[next].inbetween) next++;
        const end = offset + (next < drawings.length ? starts[next] : cycle);
        keyClips.push({ key: keyIndex[index], index, lap, start, end: Math.min(totalFrames, end) });
      }
    }
    return { keys: keyClips, middles: middleClips };
  }, [cycle, laps, drawings, starts, holds, keyIndex, totalFrames]);

  const seconds = (frame: number) => frame / EXPOSURE_FPS;

  // The playhead and clock follow every frame directly; React never re-renders for them.
  const follow = useRef(playing);
  follow.current = playing;
  // A looping player's clock keeps counting: the timeline shows where it is within the length.
  const outputFrames = durationSeconds * OUTPUT_FPS;
  const within = useCallback((frame: number) => ((frame % outputFrames) + outputFrames) % outputFrames, [outputFrames]);
  useEffect(() => {
    const place = (absolute: number) => {
      const frame = within(absolute);
      const at = x(frame / OUTPUT_FPS);
      if (playhead.current) playhead.current.style.translate = `${at}px 0`;
      if (clock.current) clock.current.textContent = timecode(frame / OUTPUT_FPS);
      const element = scroller.current;
      // While playing, the view pages along with the playhead, as an editor's timeline does.
      if (follow.current && element && (at < element.scrollLeft || at > element.scrollLeft + element.clientWidth - 24)) element.scrollLeft = Math.max(0, at - 24);
    };
    place(currentFrame());
    return subscribe(place);
  }, [subscribe, currentFrame, x, within]);

  // Zooming keeps the playhead where the eye is: centred, when the timeline is wider than the view.
  const zoomTo = (value: number) => {
    const next = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.round(value / ZOOM.step) * ZOOM.step));
    setZoom(next);
    requestAnimationFrame(() => {
      const element = scroller.current;
      if (!element) return;
      const at = 12 + (within(currentFrame()) / OUTPUT_FPS) * ((element.clientWidth - 24) / durationSeconds) * next;
      element.scrollLeft = Math.max(0, at - element.clientWidth / 2);
    });
  };

  // Scrubbing: the ruler and the empty track area seek under the pointer.
  const scrub = useRef(false);
  const seekAt = (clientX: number) => {
    const element = scroller.current;
    if (!element || pps <= 0) return;
    const left = clientX - element.getBoundingClientRect().left + element.scrollLeft;
    const time = Math.max(0, Math.min(durationSeconds, (left - 12) / pps));
    onSeek(Math.min(durationSeconds * OUTPUT_FPS - 1, Math.round(time * OUTPUT_FPS)));
  };
  const onScrubDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = true;
    seekAt(event.clientX);
  };
  const onScrubMove = (event: PointerEvent<HTMLDivElement>) => { if (scrub.current) seekAt(event.clientX); };
  const onScrubEnd = () => { scrub.current = false; };

  // First-cycle key clips: where a dragged drawing would land.
  const firstLap = keys.filter((clip) => clip.lap === 0);
  const dropIndex = (pointerX: number) => {
    let target = 0;
    for (const clip of firstLap) if (pointerX > x(seconds((clip.start + clip.end) / 2))) target = clip.key;
    return target;
  };
  const press = useRef<{ key: number; to: number; startX: number; originX: number; moved: boolean } | null>(null);
  const onClipDown = (event: PointerEvent<HTMLButtonElement>, clip: Clip) => {
    if (event.button !== 0) return;
    // Every clip takes the pointer, so the track behind it never scrubs; only first-cycle keys can be dragged.
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = onMove && clip.lap === 0 ? { key: clip.key, to: clip.key, startX: event.clientX, originX: x(seconds((clip.start + clip.end) / 2)), moved: false } : null;
  };
  const onClipMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    if (!current.moved && Math.abs(dx) < DRAG_START) return;
    current.moved = true;
    current.to = dropIndex(current.originX + dx);
    setDrag({ from: current.key, to: current.to, dx });
  };
  const onClipUp = (clip: Clip) => {
    const current = press.current;
    press.current = null;
    setDrag(null);
    if (!current?.moved) pick(clip);
    else if (current.to !== current.key) onMove?.(current.key, current.to);
  };
  const pick = (clip: Clip) => {
    onSeek(Math.ceil((clip.start * OUTPUT_FPS) / EXPOSURE_FPS - 1e-8));
    onPick(clip.key);
  };

  const keyCount = firstLap.length;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta || !keyCount) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(keyCount - 1, selectedKey + delta));
    if (event.altKey) {
      if (onMove && target !== selectedKey) onMove(selectedKey, target);
      return;
    }
    const clip = firstLap[target];
    if (clip) pick(clip);
    requestAnimationFrame(() => keyList.current?.querySelector<HTMLButtonElement>(`[data-key="${target}"][data-lap="0"]`)?.focus());
  };
  // The selection can move by itself (playback, the drawing being made): keep its clip in view while paused.
  useEffect(() => {
    if (playing) return;
    keyList.current?.querySelector<HTMLElement>(`[data-key="${selectedKey}"][data-lap="0"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey, playing]);

  const marks = useMemo(() => timelineMarks(durationSeconds, pps), [durationSeconds, pps]);

  const audioSpan = audio ? { start: Math.min(durationSeconds, audio.startsAt), end: Math.min(durationSeconds, audio.startsAt + audio.durationSeconds - audio.offset) } : null;
  const clipStyle = (clip: Pick<Clip, "start" | "end">): CSSProperties => ({ left: x(seconds(clip.start)), width: Math.max(2, (seconds(clip.end) - seconds(clip.start)) * pps - 2) });

  return (
    <section className={styles.timeline} aria-label="Timeline">
      <div className={styles.head}>
        <div className={styles.transport}>{transport}</div>
        <p className={styles.clock}>
          <span ref={clock} className={styles.now}>{timecode(within(currentFrame()) / OUTPUT_FPS)}</span>
          <span className={styles.total}> / {timecode(durationSeconds)}</span>
        </p>
        <div className={styles.tools}>
          {tools}
          <span className={styles.divider} aria-hidden />
          <Button size="icon-xs" variant="ghost" aria-label="Zoom timeline out" disabled={zoom <= ZOOM.min} onClick={() => zoomTo(zoom - 1)}><HugeiconsIcon icon={ZoomOutIcon} size={14} strokeWidth={1.75} /></Button>
          <Slider className={styles.zoom} min={ZOOM.min} max={ZOOM.max} step={ZOOM.step} value={[zoom]} onValueChange={([value]) => zoomTo(value)} aria-label="Timeline zoom" aria-valuetext={`${zoom}×`} />
          <Button size="icon-xs" variant="ghost" aria-label="Zoom timeline in" disabled={zoom >= ZOOM.max} onClick={() => zoomTo(zoom + 1)}><HugeiconsIcon icon={ZoomInIcon} size={14} strokeWidth={1.75} /></Button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.labels}>
          <span className={styles.rulerLabel} aria-hidden />
          <span className={styles.trackLabel} data-track="keys">{finite ? "Drawings" : "Key drawings"}</span>
          {inbetweenCount > 0 ? (
            <span className={styles.trackLabel} data-track="middles">
              In-betweens
              <Button size="icon-xs" variant="ghost" className={styles.trackToggle} aria-pressed={inbetweensOn} aria-label={inbetweensOn ? "Leave the in-betweens out" : "Play the in-betweens"} onClick={() => onInbetweensChange(!inbetweensOn)}>
                <HugeiconsIcon icon={inbetweensOn ? ViewIcon : ViewOffIcon} size={13} strokeWidth={1.75} />
              </Button>
            </span>
          ) : null}
          {audio ? (
            <span className={styles.trackLabel} data-track="audio">
              Audio
              <Button size="icon-xs" variant="ghost" className={styles.trackToggle} aria-pressed={audioOn} aria-label={audioOn ? "Mute the preview audio" : "Preview the audio with the animation"} onClick={() => onAudioChange(!audioOn)}>
                <HugeiconsIcon icon={audioOn ? VolumeHighIcon : VolumeOffIcon} size={13} strokeWidth={1.75} />
              </Button>
            </span>
          ) : null}
        </div>

        <div
          ref={scroller}
          className={styles.scroller}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubEnd}
          onPointerCancel={onScrubEnd}
        >
          <div className={styles.content} style={{ width }}>
            <div className={styles.ruler} aria-hidden>
              {marks.map((mark) => (
                <span key={mark.at} className={styles.mark} data-major={mark.major || undefined} style={{ left: x(mark.at) }}>
                  {mark.label ? <span className={styles.markLabel}>{mark.label}</span> : null}
                </span>
              ))}
            </div>

            <div ref={keyList} className={styles.track} data-track="keys" role="listbox" aria-label={onMove ? "Drawings in playback order. Arrow keys select, Alt plus arrow keys reorder." : "Drawings in playback order"} aria-orientation="horizontal" onKeyDown={onKeyDown}>
              {keys.map((clip) => {
                const drawing = drawings[clip.index];
                const span = (seconds(clip.end) - seconds(clip.start)) * pps;
                const dragging = drag?.from === clip.key && clip.lap === 0;
                return (
                  <button
                    key={`${clip.lap}:${drawing.id}`}
                    type="button"
                    role="option"
                    aria-selected={clip.key === selectedKey}
                    aria-label={`Drawing ${clip.key + 1}, ${drawing.label}${drawing.stateLabel ? `, ${drawing.stateLabel}` : ""}${drawing.approved ? ", approved" : ""}${drawing.flagged ? ", needs a look" : ""}`}
                    tabIndex={clip.lap === 0 && clip.key === selectedKey ? 0 : -1}
                    data-key={clip.key}
                    data-lap={clip.lap}
                    data-repeat={clip.lap > 0 || undefined}
                    data-state={drawing.status ?? "ready"}
                    data-dragging={dragging || undefined}
                    className={styles.clip}
                    style={{ ...clipStyle(clip), ...(dragging ? { translate: `${drag.dx}px 0` } : null) }}
                    onPointerDown={(event) => onClipDown(event, clip)}
                    onPointerMove={onClipMove}
                    onPointerUp={() => onClipUp(clip)}
                    onPointerCancel={() => { press.current = null; setDrag(null); }}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(clip); } }}
                  >
                    {span >= THUMB_MIN ? <span className={styles.thumb}>{clipThumb ? clipThumb(drawing) : null}</span> : null}
                    <span className={styles.clipNumber}>{clip.key + 1}</span>
                    {span >= 96 ? <span className={styles.clipLabel}>{drawing.label}</span> : null}
                    {drawing.approved ? <span className={styles.clipApproved} aria-hidden><HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={2.4} /></span> : null}
                    {drawing.flagged ? <span className={styles.clipFlag} aria-hidden><HugeiconsIcon icon={Alert02Icon} size={10} strokeWidth={2.2} /></span> : null}
                  </button>
                );
              })}
              {drag && drag.to !== drag.from ? (() => {
                const target = firstLap[drag.to];
                const at = target ? x(seconds(drag.to > drag.from ? target.end : target.start)) : 0;
                return <span className={styles.drop} style={{ left: at - 1 }} aria-hidden />;
              })() : null}
            </div>

            {inbetweenCount > 0 ? (
              <div className={styles.track} data-track="middles" data-off={!inbetweensOn || undefined}>
                {inbetweensOn ? middles.map((clip) => (
                  <button
                    key={`${clip.lap}:${drawings[clip.index].id}`}
                    type="button"
                    tabIndex={-1}
                    aria-label={`In-between ${drawings[clip.index].label}`}
                    data-repeat={clip.lap > 0 || undefined}
                    data-selected={clip.key === selectedKey || undefined}
                    className={styles.middle}
                    style={clipStyle(clip)}
                    onClick={() => onSeek(Math.ceil((clip.start * OUTPUT_FPS) / EXPOSURE_FPS - 1e-8))}
                  />
                )) : <span className={styles.offNote}>Switched off: the key drawings hold until the next one.</span>}
              </div>
            ) : null}

            {audio && audioSpan ? (
              <div className={styles.track} data-track="audio">
                {audioSpan.end > audioSpan.start ? (
                  <span className={styles.audio} data-off={!audioOn || undefined} style={{ left: x(audioSpan.start), width: Math.max(2, (audioSpan.end - audioSpan.start) * pps - 2) }} title={audio.name}>
                    <HugeiconsIcon icon={MusicNote01Icon} size={12} strokeWidth={1.75} />
                    <span className={styles.clipLabel}>{audio.name}</span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div ref={playhead} className={styles.playhead} aria-hidden><span className={styles.playheadKnob} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
