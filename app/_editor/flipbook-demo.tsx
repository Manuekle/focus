"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { FrameCarousel } from "./frame-carousel";
import styles from "./flipbook-demo.module.css";

const MOMENTS = [1, 3, 5, 7, 9, 11, 13, 15];

/** The user's illustration and dance reference, served as static local assets. */
export function FlipbookDemo() {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const [playChoice, setPlayChoice] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);
  const wantsPlayback = playChoice ?? !reducedMotion;
  const activeMoment = Math.max(0, Math.min(7, Math.round((time - 1) / 2)));

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      if (wantsPlayback && visible && !failed && !document.hidden) void video.play().catch(() => undefined);
      else video.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { document.removeEventListener("visibilitychange", sync); video.pause(); };
  }, [wantsPlayback, visible, failed]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setPlayChoice(true);
      video.muted = false;
      setMuted(false);
      void video.play().catch(() => undefined);
    } else {
      setPlayChoice(false);
      video.pause();
    }
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    if (!next) {
      video.volume = 1;
      setPlayChoice(true);
      void video.play().catch(() => undefined);
    }
  };

  const seek = (value: number) => {
    setPlayChoice(false);
    const video = videoRef.current;
    if (video) { video.pause(); video.currentTime = value; }
    setTime(value);
  };

  const pause = () => {
    setPlayChoice(false);
    videoRef.current?.pause();
  };

  return (
    <figure ref={figureRef} id="flipbook-demo" className={styles.demo} aria-label="Character and motion reference" data-flipbook-demo="">
      <div className={styles.scene}>
        <div className={styles.reference}>
          <div className={styles.photo}>
            <Image src="/demo/flipbook/reze-illustration.webp" alt="Reze, the character illustration supplied for the flipbook" width={384} height={640} loading="eager" unoptimized />
          </div>
          <span className={styles.referenceLabel}>It starts with a character.</span>
        </div>
        <div className={styles.doodle} aria-hidden="true">
          <span>a little life</span>
          <svg width="72" height="48" viewBox="0 0 72 48" fill="none"><path d="M5 9C16 35 48 39 65 17M51 19l15-4-1 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className={styles.result}>
          <div className={styles.player}>
            <video ref={videoRef} src="/demo/flipbook/reze-dance.mp4" poster="/demo/flipbook/reze-frame-2.jpg" muted={muted} playsInline loop preload="metadata" aria-label="Reze dance preview" onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onVolumeChange={(event) => setMuted(event.currentTarget.muted)} onError={() => setFailed(true)} />
            <button type="button" className={`${styles.videoControl} ${styles.videoPlay}`} aria-label={playing ? "Pause flipbook demo" : "Play flipbook demo"} onClick={toggle} disabled={failed}>
              <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={14} strokeWidth={1.75} />
            </button>
            <button type="button" className={`${styles.videoControl} ${styles.videoSound}`} aria-label={muted ? "Enable Reze sound" : "Mute Reze sound"} aria-pressed={!muted} data-muted={muted} onClick={toggleSound} disabled={failed}>
              <HugeiconsIcon icon={muted ? VolumeOffIcon : VolumeHighIcon} size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
      <FrameCarousel moments={MOMENTS} active={activeMoment} onSelect={seek} onInteract={pause} disabled={failed} />
      <figcaption className={styles.caption}>{failed ? "The preview couldn’t load. You can still create a flipbook." : "Your character. A whole new way to move."}</figcaption>
    </figure>
  );
}
