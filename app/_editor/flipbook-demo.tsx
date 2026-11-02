"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, VolumeHighIcon, VolumeMute01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import styles from "./flipbook-demo.module.css";

const DRIFT_SECONDS = 0.12;

/**
 * A real Rotoscope run: the character, the video that was filmed, and the
 * character drawn over it frame by frame. The result carries the clip's sound
 * and leads; the reference follows it so the two never drift apart.
 */
export function FlipbookDemo() {
  const reducedMotion = useReducedMotion();
  const resultRef = useRef<HTMLVideoElement>(null);
  const referenceRef = useRef<HTMLVideoElement>(null);
  const pausedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const result = resultRef.current;
    if (!result) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) result.pause();
      else if (!reducedMotion && !pausedRef.current) void result.play().catch(() => undefined);
    });
    observer.observe(result);
    return () => observer.disconnect();
  }, [reducedMotion]);

  const follow = (action: "play" | "pause" | "seek") => {
    const result = resultRef.current;
    const reference = referenceRef.current;
    if (!result || !reference) return;
    if (action === "pause") return reference.pause();
    if (Math.abs(reference.currentTime - result.currentTime) > DRIFT_SECONDS) reference.currentTime = result.currentTime;
    if (action === "play") void reference.play().catch(() => undefined);
  };

  const toggle = () => {
    const result = resultRef.current;
    if (!result) return;
    pausedRef.current = !result.paused;
    if (result.paused) void result.play().catch(() => undefined);
    else result.pause();
  };

  return (
    <figure id="flipbook-demo" className={styles.demo} aria-label="A character, a dance video, and the character drawn over it" data-flipbook-demo="">
      <div className={styles.scene}>
        <div className={styles.reference}>
          <div className={styles.photo}>
            <span className={styles.paper}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/demo/rotoscope/character.jpg" alt="The character: dark navy bob, white sleeveless shirt, black shorts" width={512} height={768} style={{ aspectRatio: "2 / 3", objectFit: "contain" }} />
            </span>
          </div>
          <span className={styles.referenceLabel}>It starts with a character.</span>
        </div>
        <div className={styles.reference}>
          <div className={styles.clip}>
            <video
              ref={referenceRef}
              src="/demo/rotoscope/reference.mp4"
              poster="/demo/rotoscope/reference.jpg"
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="The reference video"
            />
          </div>
          <span className={styles.referenceLabel}>And a video to follow.</span>
        </div>
        <div className={styles.doodle} aria-hidden="true">
          <span>comes alive</span>
          <svg width="72" height="48" viewBox="0 0 72 48" fill="none"><path d="M5 9C16 35 48 39 65 17M51 19l15-4-1 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className={styles.result}>
          <div className={styles.player}>
            <video
              ref={resultRef}
              src="/demo/rotoscope/result.mp4?v=2"
              poster="/demo/rotoscope/result.jpg?v=2"
              muted={muted}
              loop
              playsInline
              preload="metadata"
              aria-label="The character drawn over the reference video, frame by frame"
              onPlay={() => { setPlaying(true); follow("play"); }}
              onPause={() => { setPlaying(false); follow("pause"); }}
              onSeeked={() => follow("seek")}
              onTimeUpdate={() => follow("seek")}
            />
            <button type="button" className={`${styles.videoControl} ${styles.videoPlay}`} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
              <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={13} strokeWidth={2} />
            </button>
            <button type="button" className={`${styles.videoControl} ${styles.videoSound}`} onClick={() => setMuted((value) => !value)} aria-label={muted ? "Turn sound on" : "Turn sound off"} data-muted={muted}>
              <HugeiconsIcon icon={muted ? VolumeMute01Icon : VolumeHighIcon} size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </figure>
  );
}
