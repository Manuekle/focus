"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeftRightIcon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import styles from "./hero-demo.module.css";

// Real Focus renders of one clip: original stacked above edited, in one
// stream, so the two halves can never drift apart (the studio's compare.mp4 layout).
const DEMOS = [
  { id: "reality-shift", name: "Reality Shift", caption: "Everything but him, out of focus." },
  { id: "break-the-frame", name: "Break the Frame", caption: "Framed, and he walks right out of it." },
  { id: "motion-echo", name: "Motion Echo", caption: "Every move leaves a trail." },
] as const;
const WIDTH = 960;
const HEIGHT = 540;
const SWEEP_SECONDS = 7;
const SWEEP_RANGE = 30;

const media = (id: string, ext: "mp4" | "jpg") => `/demo/${id}.${ext}`;

/**
 * Before / after of real renders. The divider sweeps on its own until a
 * pointer takes it, and the effects take turns until one is chosen.
 */
export function HeroDemo() {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cycling, setCycling] = useState(true);
  const [split, setSplit] = useState(50);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef(50);
  // Where the pointer or keyboard wants the divider; null hands it back to the sweep.
  const manualRef = useRef<number | null>(null);
  const visibleRef = useRef(false);
  const demo = DEMOS[index];

  const paint = (source: CanvasImageSource) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const cut = Math.round((splitRef.current / 100) * WIDTH);
    context.drawImage(source, 0, HEIGHT, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT);
    if (cut > 0) context.drawImage(source, 0, 0, cut, HEIGHT, 0, 0, cut, HEIGHT);
    frameRef.current?.style.setProperty("--split", String(splitRef.current));
  };

  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;

    let handle = 0;
    let last = 0;
    let lastReported = 50;
    const loop = (now: number) => {
      handle = requestAnimationFrame(loop);
      const sweep = reducedMotion ? 50 : 50 + SWEEP_RANGE * Math.sin((now / 1000 / SWEEP_SECONDS) * Math.PI * 2);
      const target = manualRef.current ?? sweep;
      // Ease toward the target, so letting go glides back into the sweep.
      const ease = manualRef.current === null ? 0.06 : 0.35;
      const dt = last ? Math.min(3, (now - last) / 16.7) : 1;
      last = now;
      splitRef.current += (target - splitRef.current) * (1 - Math.pow(1 - ease, dt));
      if (video.readyState >= 2) paint(video);
      if (video.duration) figureRef.current?.style.setProperty("--progress", String(video.currentTime / video.duration));
      const rounded = Math.round(splitRef.current);
      if (rounded !== lastReported) {
        lastReported = rounded;
        setSplit(rounded);
      }
    };

    let running = false;
    // Offscreen, nothing draws and nothing decodes.
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
      if (entry.isIntersecting && !running) {
        running = true;
        handle = requestAnimationFrame(loop);
      }
      if (!entry.isIntersecting) {
        running = false;
        cancelAnimationFrame(handle);
        last = 0;
        video.pause();
      } else if (!reducedMotion && !video.dataset.userPaused) {
        void video.play().catch(() => undefined);
      }
    });
    observer.observe(frame);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(handle);
    };
  }, [reducedMotion]);

  // A new effect: hold its poster until the stream has a frame, then pull focus onto it.
  useEffect(() => {
    const poster = new Image();
    poster.onload = () => { if ((videoRef.current?.readyState ?? 0) < 2) paint(poster); };
    poster.src = media(demo.id, "jpg");
    if (!reducedMotion) {
      canvasRef.current?.animate(
        [{ filter: "blur(10px)", opacity: 0.6 }, { filter: "blur(0px)", opacity: 1 }],
        { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
  }, [demo.id, reducedMotion]);

  const onLoaded = () => {
    const video = videoRef.current;
    if (!video) return;
    paint(video);
    if (visibleRef.current && !reducedMotion && !video.dataset.userPaused) void video.play().catch(() => undefined);
  };

  const onEnded = () => {
    const video = videoRef.current;
    if (!video) return;
    if (cycling && !reducedMotion) setIndex((value) => (value + 1) % DEMOS.length);
    else {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }
  };

  const choose = (next: number) => {
    setCycling(false);
    if (next !== index) setIndex(next);
  };

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      delete video.dataset.userPaused;
      setPaused(false);
      void video.play().catch(() => undefined);
    } else {
      video.dataset.userPaused = "true";
      setPaused(true);
      video.pause();
    }
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    manualRef.current = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    const current = manualRef.current ?? splitRef.current;
    if (event.key === "ArrowLeft") manualRef.current = Math.max(0, current - step);
    else if (event.key === "ArrowRight") manualRef.current = Math.min(100, current + step);
    else if (event.key === "Home") manualRef.current = 0;
    else if (event.key === "End") manualRef.current = 100;
    else return;
    event.preventDefault();
  };

  return (
    <figure ref={figureRef} className={styles.demo} data-home-demo="" style={{ "--progress": 0 } as CSSProperties}>
      <div
        ref={frameRef}
        className={styles.frame}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerUp={(event) => { if (event.pointerType !== "mouse") manualRef.current = null; }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") manualRef.current = null; }}
      >
        <video
          ref={videoRef}
          src={media(demo.id, "mp4")}
          muted
          playsInline
          preload="auto"
          className={styles.source}
          onLoadedData={onLoaded}
          onEnded={onEnded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className={styles.canvas} role="img" aria-label={`Before and after, ${demo.name}: ${demo.caption}`} />
        <span className={`${styles.tag} ${styles.tagBefore}`} aria-hidden="true">Original</span>
        <span className={`${styles.tag} ${styles.tagAfter}`} aria-hidden="true">focus<span>.</span></span>
        <span className={styles.divider} aria-hidden="true" />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Before and after divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={split}
          aria-valuetext={`${split}% original`}
          onKeyDown={onKey}
          onBlur={() => { manualRef.current = null; }}
          className={styles.handle}
        >
          <HugeiconsIcon icon={ArrowLeftRightIcon} size={14} strokeWidth={1.75} />
        </div>
        <button type="button" className={styles.play} onClick={toggle} aria-label={playing ? "Pause demo" : "Play demo"} data-paused={paused || !playing}>
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={13} strokeWidth={2} />
        </button>
      </div>
      <figcaption className={styles.caption}>
        <div className={styles.effects} role="group" aria-label="Effects">
          {DEMOS.map((item, position) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={position === index}
              data-cycling={cycling && !reducedMotion ? "" : undefined}
              className={styles.effectTab}
              onClick={() => choose(position)}
            >
              {item.name}
              <span className={styles.effectProgress} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p key={demo.id} className={styles.line}>{demo.caption} <span>Real render</span></p>
      </figcaption>
    </figure>
  );
}
