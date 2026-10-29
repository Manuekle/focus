"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { MaximizeScreenIcon, MinimizeScreenIcon, PauseIcon, PlayIcon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../icons/icon";
import { cn } from "../../lib/utils";
import { formatSeconds } from "../../shared/media";
import { Button } from "./button";
import { Slider } from "./slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import styles from "./video-player.module.css";

type VideoPlayerProps = {
  src: string;
  label: string;
  className?: string;
  segment?: { start: number; durationSeconds: number };
  hasAudio?: boolean;
  onLoadedMetadata?: ComponentProps<"video">["onLoadedMetadata"];
  onError?: ComponentProps<"video">["onError"];
};

/** Shared reference preview; changing the source resets playback and media state. */
export function VideoPlayer(props: VideoPlayerProps) {
  return <Player key={props.src} {...props} />;
}

function Player({ src, label, className, segment, hasAudio = true, onLoadedMetadata, onError }: VideoPlayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [error, setError] = useState("");
  const ready = duration > 0;
  const start = Math.min(Math.max(0, segment?.start ?? 0), duration);
  const end = Math.min(duration, segment ? start + segment.durationSeconds : duration);
  const length = Math.max(0, end - start);
  const position = Math.max(0, Math.min(time - start, length));

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current);
    setCanFullscreen(Boolean(document.fullscreenEnabled || (video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !ready) return;
    element.pause();
    element.currentTime = start;
    setTime(start);
  }, [start, length, ready]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = video.current;
      if (!element) return;
      if (element.currentTime >= end) {
        element.pause();
        element.currentTime = end;
        setTime(end);
        return;
      }
      setTime(element.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end]);

  const toggle = async () => {
    const element = video.current;
    if (!element || !ready) return;
    if (!element.paused) { element.pause(); return; }
    if (element.currentTime < start || element.currentTime >= end - 0.01) element.currentTime = start;
    try { await element.play(); setError(""); }
    catch { setError("Video could not play. Try again or replace the reference."); }
  };

  const expand = async () => {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (root.current?.requestFullscreen && document.fullscreenEnabled) await root.current.requestFullscreen();
      else (video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
    } catch { setError("Fullscreen is unavailable. You can keep playing the preview here."); }
  };

  const control = (name: string, icon: typeof PlayIcon, onClick: () => void, disabled = false, pressed?: boolean) => (
    <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className={styles.control} aria-label={name} aria-pressed={pressed} disabled={disabled} onClick={onClick}><HugeiconsIcon icon={icon} size={16} strokeWidth={1.75} /></Button></TooltipTrigger><TooltipContent>{name}</TooltipContent></Tooltip>
  );

  return <div ref={root} className={cn(styles.player, className)} role="group" aria-label={`${label} player`}>
    <video ref={video} src={src} className={styles.video} playsInline muted={muted} preload="metadata" aria-label={label}
      onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setDuration(value); onLoadedMetadata?.(event); }}
      onPlay={() => setPlaying(true)} onPause={(event) => { setPlaying(false); setTime(event.currentTarget.currentTime); }} onEnded={() => setPlaying(false)}
      onVolumeChange={(event) => setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
      onTimeUpdate={(event) => { const element = event.currentTarget; if (element.currentTime >= end && ready) { element.pause(); if (element.currentTime > end) element.currentTime = end; } setTime(element.currentTime); }}
      onError={(event) => { setPlaying(false); setError("This video could not be read. Replace it with an MP4 or MOV file."); onError?.(event); }} />
    <div className={styles.toolbar}>
      <Slider aria-label="Video position" aria-valuetext={`${formatSeconds(position)} of ${formatSeconds(length)}`} min={0} max={length || 1} step={0.01} value={[position]} disabled={!ready || !length} onValueChange={([value]) => { if (video.current) { video.current.currentTime = start + value; setTime(start + value); } }} />
      <div className={styles.row}>
        {control(playing ? "Pause reference video" : "Play reference video", playing ? PauseIcon : PlayIcon, () => void toggle(), !ready || !length)}
        <span className={styles.time}>{ready ? <>{formatSeconds(position)}<span className={styles.separator}>/</span>{formatSeconds(length)}</> : error ? "Video unavailable" : "Loading video…"}</span>
        <div className={styles.actions}>
          {hasAudio ? control(muted ? "Unmute reference video" : "Mute reference video", muted ? VolumeOffIcon : VolumeHighIcon, () => { if (video.current) { video.current.muted = !muted; if (video.current.volume === 0) video.current.volume = 1; } }, !ready) : null}
          {canFullscreen ? control(fullscreen ? "Exit fullscreen" : "Enter fullscreen", fullscreen ? MinimizeScreenIcon : MaximizeScreenIcon, () => void expand(), !ready) : null}
        </div>
      </div>
    </div>
    <p className={styles.error} role="status">{error}</p>
  </div>;
}
