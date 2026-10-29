"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { PauseIcon, PlayIcon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { formatSeconds } from "../../shared/media";
import type { VideoAsset } from "../../shared/schemas";
import { EditorNotice } from "./editor-notice";
import { FreezeTimeline, type FreezeControl } from "./freeze-timeline";
import { triggerFrame } from "../../shared/temporal";

/** The centerpiece: the normalized video exactly as the pipeline will read it. */
export function VideoStage({
  video,
  overlay,
  hud,
  tools,
  freeze,
}: {
  readonly video: VideoAsset;
  /** Drawn exactly over the video frame (same box), e.g. the tracking overlay. */
  readonly overlay?: (videoRef: RefObject<HTMLVideoElement | null>) => ReactNode;
  /** Small status line pinned to the top-left of the frame. */
  readonly hud?: ReactNode;
  /** Extra controls in the caption bar. */
  readonly tools?: ReactNode;
  readonly freeze?: FreezeControl;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.normalized.durationSeconds);
  const [failed, setFailed] = useState(false);
  const { width, height, fps, hasAudio } = video.normalized;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    // rAF while playing so the scrubber moves smoothly; timeupdate fires ~4×/s.
    const tick = () => {
      setTime(element.currentTime);
      frame = requestAnimationFrame(tick);
    };
    if (playing) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  };

  const seek = (value: number) => {
    const element = ref.current;
    if (!element) return;
    element.currentTime = value;
    setTime(value);
  };

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="relative grid place-items-center bg-[var(--editor-stage)]">
        <div className="relative max-w-full">
        <video
          ref={ref}
          src={video.urls.preview}
          poster={video.urls.poster}
          width={width}
          height={height}
          muted={muted}
          playsInline
          loop
          preload="auto"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value)) setDuration(value);
            if (freeze?.trigger.timestampMs !== undefined) {
              const at = triggerFrame(freeze.trigger.timestampMs, video.normalized) / fps;
              event.currentTarget.currentTime = at;
              setTime(at);
            }
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onError={() => setFailed(true)}
          className="block h-auto max-h-[min(68dvh,720px)] w-auto max-w-full cursor-pointer"
          aria-label={`Preview of ${video.originalName}`}
        />
        {overlay?.(ref)}
        {hud ? (
          <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-[rgb(20_22_30/0.82)] px-2 py-1 text-xs leading-4 text-white tabular-nums">
            {hud}
          </div>
        ) : null}
        </div>
        {failed ? (
          <EditorNotice title="Preview couldn’t be played" description="Reload the page or upload your video again." />
        ) : null}
      </div>

      <figcaption className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={18} strokeWidth={1.75} />
        </button>
        <span className="w-[72px] shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatSeconds(time)} / {formatSeconds(duration)}
        </span>
        {!freeze ? <input
          type="range"
          min={0}
          max={duration || 0}
          step={1 / fps}
          value={Math.min(time, duration)}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          aria-label="Video position"
          aria-valuetext={`${formatSeconds(time)} of ${formatSeconds(duration)}`}
          className="editor-scrubber min-w-0 flex-1"
          style={{ "--scrub": `${progress}%` } as CSSProperties}
        /> : <span className="min-w-0 flex-1 text-right text-xs text-muted-foreground">Choose a moment in the original clip</span>}
        {hasAudio ? (
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={!muted}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HugeiconsIcon icon={muted ? VolumeOffIcon : VolumeHighIcon} size={17} strokeWidth={1.75} />
          </button>
        ) : null}
        {tools}
        {freeze ? <FreezeTimeline media={video.normalized} time={time} control={freeze} onSeek={(value) => { ref.current?.pause(); seek(value); }} /> : null}
      </figcaption>
    </figure>
  );
}
