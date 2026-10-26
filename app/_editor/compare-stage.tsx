"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { PauseIcon, PlayIcon, VolumeHighIcon, VolumeMute01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { formatSeconds } from "../../shared/media";
import type { RenderResult } from "../../shared/render";

type Mode = "compare" | "edited";

/**
 * The edited result. "Antes / después" draws both halves of one stacked
 * stream (original above, edited below) from a single <video>, so the two
 * sides can never drift apart. "Editado" plays the exported MP4 itself, with
 * its audio — exactly the file the download button delivers.
 */
export function CompareStage({ render }: { readonly render: RenderResult }) {
  const [mode, setMode] = useState<Mode>("compare");
  const [split, setSplit] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const compareRef = useRef<HTMLVideoElement>(null);
  const editedRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const splitRef = useRef(split);
  const { width, height } = render;
  const duration = render.durationSeconds;

  const active = () => (mode === "compare" ? compareRef.current : editedRef.current);

  useEffect(() => {
    splitRef.current = split;
  }, [split]);

  // Draw on every presented frame of the comparison stream.
  useEffect(() => {
    if (mode !== "compare") return;
    const video = compareRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!video || !canvas || !context) return;
    let handle = 0;
    let stopped = false;
    const draw = () => {
      if (video.readyState < 2) return;
      const cut = Math.round((splitRef.current / 100) * width);
      // Edited (bottom half of the stream) everywhere…
      context.drawImage(video, 0, height, width, height, 0, 0, width, height);
      // …and the original (top half) left of the divider.
      if (cut > 0) context.drawImage(video, 0, 0, cut, height, 0, 0, cut, height);
      setTime(video.currentTime);
    };
    const hasFrameCallback = "requestVideoFrameCallback" in video;
    const loop = () => {
      if (stopped) return;
      draw();
      handle = hasFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    video.addEventListener("loadeddata", draw);
    video.addEventListener("seeked", draw);
    loop();
    return () => {
      stopped = true;
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
      if (hasFrameCallback) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [mode, width, height, render.urls.compare]);

  // A paused frame must redraw when the divider moves.
  useEffect(() => {
    const video = compareRef.current;
    const context = canvasRef.current?.getContext("2d");
    if (mode !== "compare" || !video || !context || video.readyState < 2 || !video.paused) return;
    const cut = Math.round((split / 100) * width);
    context.drawImage(video, 0, height, width, height, 0, 0, width, height);
    if (cut > 0) context.drawImage(video, 0, 0, cut, height, 0, 0, cut, height);
  }, [split, mode, width, height]);

  const switchMode = (next: Mode) => {
    const from = active();
    const at = from?.currentTime ?? 0;
    from?.pause();
    setPlaying(false);
    setMode(next);
    requestAnimationFrame(() => {
      const to = next === "compare" ? compareRef.current : editedRef.current;
      if (to) to.currentTime = at;
    });
  };

  const toggle = () => {
    const video = active();
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };

  const seek = (value: number) => {
    const video = active();
    if (video) video.currentTime = value;
    setTime(value);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)));
  };

  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") setSplit((value) => Math.max(0, value - step));
    else if (event.key === "ArrowRight") setSplit((value) => Math.min(100, value + step));
    else if (event.key === "Home") setSplit(0);
    else if (event.key === "End") setSplit(100);
    else return;
    event.preventDefault();
  };

  const mediaEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: (event: { currentTarget: HTMLVideoElement }) => setTime(event.currentTarget.currentTime),
  };

  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="relative grid place-items-center bg-[var(--editor-stage)]">
        <video ref={compareRef} src={render.urls.compare} muted playsInline loop preload="auto" className="hidden" {...mediaEvents} />
        {mode === "compare" ? (
          <div
            className="relative max-w-full cursor-ew-resize touch-none select-none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              fromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
            }}
          >
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              aria-label="Comparación antes y después"
              className="block h-auto max-h-[min(68dvh,720px)] w-auto max-w-full"
              style={{ aspectRatio: `${width} / ${height}` }}
            />
            <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-[rgb(20_22_30/0.78)] px-2 py-1 text-[11px] text-white">Original</span>
            <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground">Editado</span>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90" style={{ left: `${split}%` }} />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Divisor antes/después"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              aria-valuetext={`${Math.round(split)}% original`}
              onKeyDown={onHandleKey}
              className="absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-[rgb(20_22_30/0.72)] text-white shadow-[var(--shadow-elevated)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: `${split}%` }}
            >
              <span aria-hidden className="text-xs tracking-normal">‹ ›</span>
            </div>
          </div>
        ) : (
          <video
            ref={editedRef}
            src={render.urls.video}
            muted={muted}
            playsInline
            loop
            preload="auto"
            onClick={toggle}
            className="block h-auto max-h-[min(68dvh,720px)] w-auto max-w-full cursor-pointer"
            aria-label="Video editado"
            {...mediaEvents}
          />
        )}
      </div>

      <figcaption className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2.5 sm:px-4">
        <button type="button" onClick={toggle} aria-label={playing ? "Pausar" : "Reproducir"} className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground transition-colors hover:bg-muted">
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={18} strokeWidth={1.75} />
        </button>
        <span className="w-[72px] shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatSeconds(time)} / {formatSeconds(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration}
          step={1 / render.fps}
          value={Math.min(time, duration)}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          aria-label="Posición en el video"
          className="editor-scrubber min-w-0 flex-1"
          style={{ "--scrub": `${(time / duration) * 100}%` } as CSSProperties}
        />
        {mode === "edited" && render.hasAudio ? (
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
            aria-pressed={!muted}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={muted ? VolumeMute01Icon : VolumeHighIcon} size={17} strokeWidth={1.75} />
          </button>
        ) : null}
        <SlidingTabs
          tabs={[
            { id: "compare", label: "Antes / después" },
            { id: "edited", label: "Editado" },
          ]}
          value={mode}
          onValueChange={(id) => switchMode(id as Mode)}
        />
      </figcaption>
    </figure>
  );
}
