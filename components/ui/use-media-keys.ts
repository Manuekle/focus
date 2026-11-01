"use client";

import { useCallback, type KeyboardEvent } from "react";

type MediaKeyActions = {
  toggle: () => void;
  /** Seconds to move from the current position; negative goes back. */
  seekBy?: (seconds: number) => void;
  /** 0 = start, 1 = end of what the player shows. */
  seekTo?: (fraction: number) => void;
  toggleMute?: () => void;
  toggleFullscreen?: () => void;
};

/** Controls that already own these keys: Space presses a button, arrows move a slider or caret. */
const OWNS_KEYS = 'button, a[href], input, textarea, select, [contenteditable="true"], [role="slider"], [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"]';

/**
 * The keys every web player answers to, for players drawn by hand around a <video>:
 * Space/K play-pause, ←/→ (J/L) seek, Home/End, M mute, F fullscreen.
 * Put `onKeyDown` on the player's root; it fires when the video (made focusable) or
 * any plain part of the player has focus, and leaves buttons and sliders their own keys.
 */
export function useMediaKeys({ toggle, seekBy, seekTo, toggleMute, toggleFullscreen }: MediaKeyActions) {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target !== event.currentTarget && event.target.closest(OWNS_KEYS)) return;
    const step = event.shiftKey ? 1 : 5;
    const run: Record<string, (() => void) | undefined> = {
      " ": toggle,
      k: toggle,
      ArrowLeft: seekBy && (() => seekBy(-step)),
      j: seekBy && (() => seekBy(-10)),
      ArrowRight: seekBy && (() => seekBy(step)),
      l: seekBy && (() => seekBy(10)),
      Home: seekTo && (() => seekTo(0)),
      End: seekTo && (() => seekTo(1)),
      m: toggleMute,
      f: toggleFullscreen,
    };
    const action = run[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }, [toggle, seekBy, seekTo, toggleMute, toggleFullscreen]);
}
