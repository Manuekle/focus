"use client";

import { useCallback, useEffect, useRef } from "react";
import type { FlipbookAudio } from "../../shared/sequence";

/** Shares the player's absolute clock; no independent accumulating audio timer. */
export function useTimelineAudio(track: FlipbookAudio | undefined, url: string | undefined, playing: boolean, rate: number, enabled: boolean, duration: number) {
  const element = useRef<HTMLAudioElement | null>(null);
  const state = useRef({ track, playing, rate, enabled, duration });
  state.current = { track, playing, rate, enabled, duration };
  useEffect(() => {
    const audio = url ? new Audio(url) : null;
    element.current = audio;
    if (audio) audio.preload = "metadata";
    return () => { audio?.pause(); if (audio) { audio.removeAttribute("src"); audio.load(); } element.current = null; };
  }, [url]);
  useEffect(() => { if (!playing || !enabled) element.current?.pause(); }, [playing, enabled]);
  return useCallback((seconds: number) => {
    const audio = element.current;
    const current = state.current;
    if (!audio || !current.track) return;
    const time = ((seconds % current.duration) + current.duration) % current.duration;
    const target = time - current.track.startsAt + current.track.offset;
    if (!current.enabled || !current.playing || time < current.track.startsAt || target >= current.track.durationSeconds) { audio.pause(); return; }
    audio.volume = Math.min(1, current.track.volume);
    audio.playbackRate = current.rate;
    if (audio.readyState >= 1 && Math.abs(audio.currentTime - target) > 0.12) audio.currentTime = Math.max(0, target);
    if (audio.paused) void audio.play().catch(() => undefined);
  }, []);
}
