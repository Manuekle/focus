"use client";

import { useCallback, useSyncExternalStore } from "react";
import { VolumeHighIcon, VolumeLowIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "../icons/icon";
import { cn } from "../../lib/utils";
import { Slider } from "./slider";

export type Sound = { readonly volume: number; readonly muted: boolean };

const KEY = "focus.video.sound";
const DEFAULT_SOUND: Sound = { volume: 1, muted: false };
const MIN_AUDIBLE = 0.1;
const listeners = new Set<() => void>();
let current: Sound | null = null;

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));

/** The person's sound setting, read once and kept: every player shares it, so a clip never starts louder than the last one ended. */
function read(): Sound {
  if (current) return current;
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Sound> | null;
    if (stored) return (current = { volume: clamp(Number(stored.volume)), muted: stored.muted === true });
  } catch {
    // Private window or blocked storage: the default stands for this visit.
  }
  return (current = DEFAULT_SOUND);
}

function write(next: Sound) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not remembered; still applied.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Volume and mute, shared by every video player and remembered between visits. Sound is on until the person turns it off. */
export function useSound() {
  const sound = useSyncExternalStore(subscribe, read, () => DEFAULT_SOUND);
  const setVolume = useCallback((volume: number) => {
    // Dragging to zero is muting; anything above it is sound again.
    write(volume <= 0 ? { ...read(), muted: true } : { volume: clamp(volume), muted: false });
  }, []);
  const toggleMute = useCallback(() => {
    const now = read();
    write({ volume: now.volume < MIN_AUDIBLE ? 0.6 : now.volume, muted: !now.muted });
  }, []);
  return { sound, setVolume, toggleMute };
}

/** Keeps a <video> at the shared sound setting. */
export function applySound(element: HTMLVideoElement | null, sound: Sound) {
  if (!element) return;
  element.volume = sound.volume;
  element.muted = sound.muted;
}

/** A mute button and a volume slider, for any player whose clip has sound. */
export function VolumeControl({
  sound,
  onVolume,
  onToggle,
  className,
  buttonClassName,
  disabled,
}: {
  readonly sound: Sound;
  readonly onVolume: (volume: number) => void;
  readonly onToggle: () => void;
  readonly className?: string;
  readonly buttonClassName?: string;
  readonly disabled?: boolean;
}) {
  const silent = sound.muted || sound.volume <= 0;
  const shown = silent ? 0 : Math.round(sound.volume * 100);
  return (
    <div className={cn("group/sound flex shrink-0 items-center gap-1", className)}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={silent ? "Unmute" : "Mute"}
        aria-pressed={!silent}
        className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", buttonClassName)}
      >
        <HugeiconsIcon icon={silent ? VolumeOffIcon : shown < 50 ? VolumeLowIcon : VolumeHighIcon} size={17} strokeWidth={1.75} />
      </button>
      <Slider
        className="w-[72px]"
        min={0}
        max={100}
        step={1}
        value={[shown]}
        disabled={disabled}
        onValueChange={([value]) => onVolume(value / 100)}
        aria-label="Volume"
        aria-valuetext={silent ? "Muted" : `${shown} percent`}
      />
    </div>
  );
}
