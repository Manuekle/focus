"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { MusicNote01Icon, PauseIcon, PlayIcon, ZoomInIcon, ZoomOutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { timecode, timelineMarks } from "../flipbook/frame-timeline";
import styles from "../flipbook/frame-timeline.module.css";

const ZOOM = { min: 1, max: 12, step: 0.25 } as const;
const FILM_FRAMES = 18;

export type TimelineSpan = { readonly start: number; readonly end: number; readonly tone: "masks" | "effect" | "freeze"; readonly label?: string };
export type TimelineLane = { readonly id: string; readonly label: string; readonly spans: readonly TimelineSpan[]; readonly markers?: readonly number[] };

/**
 * Frames of a clip for the video track: a hidden <video> seeks through it once
 * and each frame is kept as a small JPEG. Best effort: on any failure the
 * track stays a plain bar.
 */
function useFilmstrip(src: string, count: number): readonly string[] {
  const [frames, setFrames] = useState<{ src: string; images: string[] }>({ src, images: [] });
  useEffect(() => {
    let canceled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = src;
    const canvas = document.createElement("canvas");
    const images: string[] = [];
    const next = () => {
      if (canceled || images.length >= count || !Number.isFinite(video.duration) || video.duration <= 0) return;
      video.currentTime = ((images.length + 0.5) / count) * video.duration;
    };
    const capture = () => {
      if (canceled) return;
      const context = canvas.getContext("2d");
      if (!context || !video.videoWidth) return;
      canvas.height = 72;
      canvas.width = Math.round((72 * video.videoWidth) / video.videoHeight);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      images.push(canvas.toDataURL("image/jpeg", 0.6));
      setFrames({ src, images: [...images] });
      next();
    };
    video.addEventListener("loadeddata", next);
    video.addEventListener("seeked", capture);
    return () => {
      canceled = true;
      video.removeEventListener("loadeddata", next);
      video.removeEventListener("seeked", capture);
      video.removeAttribute("src");
      video.load();
    };
  }, [src, count]);
  return frames.src === src ? frames.images : [];
}

/**
 * The video editor's timeline, the same instrument as Flipbook's
 * (app/flipbook/frame-timeline.tsx): a ruler, the clip as a filmstrip, lanes
 * for what the edit touches (tracked masks, the effect, the freeze), audio,
 * and a playhead on the <video> the stage is playing. Click or drag the ruler
 * or a track to scrub.
 */
export function MediaTimeline({
  media,
  duration,
  film,
  lanes,
  audio,
  tools,
}: {
  /** The <video> on stage; the timeline reads and seeks it. */
  readonly media: HTMLVideoElement | null;
  readonly duration: number;
  readonly film: { readonly src: string; readonly name: string };
  readonly lanes: readonly TimelineLane[];
  readonly audio: boolean;
  readonly tools?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [viewport, setViewport] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const thumbs = useFilmstrip(film.src, FILM_FRAMES);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element);
    setViewport(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const length = duration > 0 ? duration : 1;
  const pps = viewport > 0 ? ((viewport - 24) / length) * zoom : 0;
  const width = Math.max(viewport, length * pps + 24);
  const x = (seconds: number) => 12 + seconds * pps;
  const marks = useMemo(() => timelineMarks(length, pps), [length, pps]);

  // The playhead and clock follow the video directly: every frame while it plays, on each seek while paused.
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  useEffect(() => {
    if (!media) return;
    let frame = 0;
    const place = () => {
      const at = 12 + media.currentTime * ppsRef.current;
      if (playhead.current) playhead.current.style.translate = `${at}px 0`;
      if (clock.current) clock.current.textContent = timecode(media.currentTime);
      const element = scroller.current;
      if (!media.paused && element && (at < element.scrollLeft || at > element.scrollLeft + element.clientWidth - 24)) element.scrollLeft = Math.max(0, at - 24);
    };
    const loop = () => { place(); frame = requestAnimationFrame(loop); };
    const onPlay = () => { setPlaying(true); cancelAnimationFrame(frame); loop(); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(frame); place(); };
    setPlaying(!media.paused);
    if (media.paused) place(); else loop();
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("seeked", place);
    media.addEventListener("timeupdate", place);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("seeked", place);
      media.removeEventListener("timeupdate", place);
    };
  }, [media]);
  // A new scale moves the playhead with it.
  useEffect(() => {
    if (media && playhead.current) playhead.current.style.translate = `${12 + media.currentTime * pps}px 0`;
  }, [pps, media]);

  const zoomTo = (value: number) => {
    const next = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.round(value / ZOOM.step) * ZOOM.step));
    setZoom(next);
    requestAnimationFrame(() => {
      const element = scroller.current;
      if (!element || !media) return;
      const at = 12 + media.currentTime * ((element.clientWidth - 24) / length) * next;
      element.scrollLeft = Math.max(0, at - element.clientWidth / 2);
    });
  };

  const scrub = useRef(false);
  const seekAt = (clientX: number) => {
    const element = scroller.current;
    if (!element || !media || pps <= 0) return;
    const left = clientX - element.getBoundingClientRect().left + element.scrollLeft;
    media.currentTime = Math.max(0, Math.min(length - 0.001, (left - 12) / pps));
  };
  const onScrubDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !media) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = true;
    media.pause();
    seekAt(event.clientX);
  };
  const onScrubMove = (event: PointerEvent<HTMLDivElement>) => { if (scrub.current) seekAt(event.clientX); };
  const onScrubEnd = () => { scrub.current = false; };

  const toggle = () => {
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  };

  const spanStyle = (start: number, end: number) => ({ left: x(Math.max(0, start)), width: Math.max(2, (Math.min(length, end) - Math.max(0, start)) * pps - 2) });

  return (
    <section className={styles.timeline} aria-label="Timeline">
      <div className={styles.head}>
        <div className={styles.transport}>
          <Button size="icon-sm" variant="secondary" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={toggle} disabled={!media}>
            <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={16} strokeWidth={1.75} />
          </Button>
        </div>
        <p className={styles.clock}>
          <span ref={clock} className={styles.now}>{timecode(media?.currentTime ?? 0)}</span>
          <span className={styles.total}> / {timecode(length)}</span>
        </p>
        <div className={styles.tools}>
          {tools}
          {tools ? <span className={styles.divider} aria-hidden /> : null}
          <Button size="icon-xs" variant="ghost" aria-label="Zoom timeline out" disabled={zoom <= ZOOM.min} onClick={() => zoomTo(zoom - 1)}><HugeiconsIcon icon={ZoomOutIcon} size={14} strokeWidth={1.75} /></Button>
          <Slider className={styles.zoom} min={ZOOM.min} max={ZOOM.max} step={ZOOM.step} value={[zoom]} onValueChange={([value]) => zoomTo(value)} aria-label="Timeline zoom" aria-valuetext={`${zoom}×`} />
          <Button size="icon-xs" variant="ghost" aria-label="Zoom timeline in" disabled={zoom >= ZOOM.max} onClick={() => zoomTo(zoom + 1)}><HugeiconsIcon icon={ZoomInIcon} size={14} strokeWidth={1.75} /></Button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.labels}>
          <span className={styles.rulerLabel} aria-hidden />
          <span className={styles.trackLabel} data-track="video">Video</span>
          {lanes.map((lane) => <span key={lane.id} className={styles.trackLabel} data-track="lane">{lane.label}</span>)}
          {audio ? <span className={styles.trackLabel} data-track="audio">Audio</span> : null}
        </div>

        <div ref={scroller} className={styles.scroller} onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubEnd} onPointerCancel={onScrubEnd}>
          <div className={styles.content} style={{ width }}>
            <div className={styles.ruler} aria-hidden>
              {marks.map((mark) => (
                <span key={mark.at} className={styles.mark} data-major={mark.major || undefined} style={{ left: x(mark.at) }}>
                  {mark.label ? <span className={styles.markLabel}>{mark.label}</span> : null}
                </span>
              ))}
            </div>

            <div className={styles.track} data-track="video">
              <span className={styles.filmstrip} style={spanStyle(0, length)} title={film.name}>
                {/* Frames captured in the browser as data URLs: nothing for next/image to optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {thumbs.map((thumb, index) => <img key={index} src={thumb} alt="" draggable={false} />)}
                <span className={styles.filmstripName}>{film.name}</span>
              </span>
            </div>

            {lanes.map((lane) => (
              <div key={lane.id} className={styles.track} data-track="lane">
                {lane.spans.map((span, index) => (
                  <span key={index} className={styles.span} data-tone={span.tone} style={spanStyle(span.start, span.end)} title={span.label}>
                    {span.label ? <span className={styles.clipLabel}>{span.label}</span> : null}
                  </span>
                ))}
                {lane.markers?.map((at) => <span key={at} className={styles.marker} style={{ left: x(at) }} aria-hidden />)}
              </div>
            ))}

            {audio ? (
              <div className={styles.track} data-track="audio">
                <span className={styles.audio} style={spanStyle(0, length)}>
                  <HugeiconsIcon icon={MusicNote01Icon} size={12} strokeWidth={1.75} />
                  <span className={styles.clipLabel}>Clip audio</span>
                </span>
              </div>
            ) : null}

            <div ref={playhead} className={styles.playhead} aria-hidden><span className={styles.playheadKnob} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
