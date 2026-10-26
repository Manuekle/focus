"use client";

import {
  bind,
  play,
  press,
  release,
  setEnabled as setLibEnabled,
  setTheme as setLibTheme,
  setVolume as setLibVolume,
  themes,
  unlock,
  type PlayOptions,
  type SoundName,
  type ThemeName,
} from "cuelume";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playCelebration, prepareCelebrationAudio, stopCelebrationSound } from "../lib/celebration-sound";

/**
 * Cuelume's fourteen cues plus the celebration burst.
 *
 * Callers ask for cues by the job they do (`success`, `close`, `navigate`)
 * and should not have to know which synth answers.
 */
export type CueName = SoundName | "celebration";

/** The material every cue is played in: glass and wood, machined parts, bubbles, or a deep key. */
export type SoundTheme = ThemeName;
export const SOUND_THEMES: readonly SoundTheme[] = themes;

export type CueOptions = PlayOptions & {
  /**
   * Stay quiet when a control the person pressed already sounded within this
   * many milliseconds. For outcomes that a click usually announces first: a
   * route the nav link already whooshed to, a dialog its own close button
   * already shut.
   */
  readonly unlessPressedWithin?: number;
  /** Narrows `unlessPressedWithin` to a press that played this cue. */
  readonly unlessPressedAs?: SoundName;
};

const ENABLED_KEY = "focus:sound-enabled";
const VOLUME_KEY = "focus:sound-volume";
const THEME_KEY = "focus:sound-theme";
const DEFAULT_VOLUME = 0.35;
const DEFAULT_ENABLED = false;
// Bubble: knocks, drips, corks and gulps. Picked over the glass `default` for
// how it sits in this product; anyone can switch in Account.
const DEFAULT_THEME: SoundTheme = "bubble";

/** The cue each click attribute plays when its value names none. */
const TAG_CUES: Readonly<Record<string, SoundName>> = {
  "data-cuelume-tap": "tap",
  "data-cuelume-select": "select",
  "data-cuelume-toggle": "toggle",
  "data-cuelume-open": "open",
  "data-cuelume-close": "close",
  "data-cuelume-navigate": "navigate",
};

/** Every attribute `bind()` owns, plus the app's own opt-out. */
const TAGGED =
  "[data-cuelume-tap],[data-cuelume-select],[data-cuelume-toggle],[data-cuelume-open],[data-cuelume-close],[data-cuelume-navigate],[data-cuelume-type],[data-cuelume-silent]";

/** What the floor answers for. Not `a[href]`: a text link is not a control. */
const CONTROL =
  'button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],summary';

type FloorCue = { readonly name: SoundName; readonly options: PlayOptions };

function isTheme(value: unknown): value is SoundTheme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

/**
 * The cue an untagged control gets, read from what it already says about
 * itself. Called before the app's own handlers run, so `aria-expanded` and
 * `aria-checked` still hold the state the press is about to change.
 */
function floorCue(element: HTMLElement): FloorCue {
  const emphasis = element.closest("[data-cuelume-emphasis]")?.getAttribute("data-cuelume-emphasis");
  const weight = (fallback: PlayOptions["emphasis"]) =>
    emphasis === "subtle" || emphasis === "normal" || emphasis === "strong" ? emphasis : fallback;
  const role = element.getAttribute("role");

  if (role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio" || role === "option" || role === "tab") {
    return { name: "select", options: { emphasis: weight("normal") } };
  }
  if (role === "switch" || role === "checkbox" || role === "radio") {
    const on = element.getAttribute("aria-checked") === "true";
    return { name: "toggle", options: { emphasis: weight("normal"), direction: on && role !== "radio" ? "back" : "forward" } };
  }
  if (element.tagName === "SUMMARY") {
    const open = element.parentElement instanceof HTMLDetailsElement && element.parentElement.open;
    return { name: open ? "close" : "open", options: { emphasis: weight("subtle") } };
  }
  // Menus, popovers, selects, accordions and every other disclosure say
  // which way they are about to go.
  const expanded = element.getAttribute("aria-expanded");
  if (expanded === "true") return { name: "close", options: { emphasis: weight("subtle") } };
  if (expanded === "false") return { name: "open", options: { emphasis: weight("subtle") } };
  return { name: "tap", options: { emphasis: weight("subtle") } };
}

type SoundContextValue = {
  readonly enabled: boolean;
  readonly volume: number;
  readonly theme: SoundTheme;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setVolume: (volume: number) => void;
  readonly setTheme: (theme: SoundTheme) => void;
  /** Play a sound for an outcome the user caused. No-op while muted. */
  readonly cue: (name: CueName, options?: CueOptions) => void;
};

const SoundContext = createContext<SoundContextValue | null>(null);

/**
 * Focus interaction sounds start muted; an explicit saved mute always wins.
 * Sound only follows interaction. Mutable preferences let an async outcome
 * respect a mute/volume change made while its request was in flight.
 */
export function SoundProvider({ children }: { readonly children: ReactNode }) {
  const [enabled, setEnabledState] = useState(DEFAULT_ENABLED);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [theme, setThemeState] = useState<SoundTheme>(DEFAULT_THEME);
  const preferences = useRef({ enabled: DEFAULT_ENABLED, volume: DEFAULT_VOLUME });
  /** When a pressed control last made its own sound, and which. */
  const lastPressCue = useRef<{ at: number; name: SoundName | null }>({ at: -Infinity, name: null });

  // Read the preference after mount: touching localStorage during render would
  // make the server and the first client pass disagree.
  useEffect(() => {
    let nextEnabled = DEFAULT_ENABLED;
    let nextVolume = DEFAULT_VOLUME;
    let nextTheme = DEFAULT_THEME;
    try {
      const storedEnabled = localStorage.getItem(ENABLED_KEY);
      if (storedEnabled === "0" || storedEnabled === "1") nextEnabled = storedEnabled === "1";
      // Guard on the key existing, not just on the parse: `Number(null)` is 0,
      // which is a perfectly valid volume — so a first visit would silently
      // pin the volume to zero and every cue would play as nothing.
      const raw = localStorage.getItem(VOLUME_KEY);
      if (raw !== null) {
        const stored = Number(raw);
        if (Number.isFinite(stored) && stored >= 0 && stored <= 1) nextVolume = stored;
      }
      const storedTheme = localStorage.getItem(THEME_KEY);
      if (isTheme(storedTheme)) nextTheme = storedTheme;
    } catch {
      // Private mode / blocked storage — defaults are fine.
    }
    preferences.current = { enabled: nextEnabled, volume: nextVolume };
    setLibEnabled(nextEnabled);
    setLibVolume(nextVolume);
    setLibTheme(nextTheme);
    setEnabledState(nextEnabled);
    setVolumeState(nextVolume);
    setThemeState(nextTheme);
  }, []);

  // A successful fetch runs outside the initiating gesture. Prime the
  // celebration context silently during that gesture, including keyboard
  // clicks and the first touch (whose activation may arrive only on click).
  useEffect(() => {
    const prepare = (event: Event) => {
      if (!preferences.current.enabled || preferences.current.volume <= 0) return;
      if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
      prepareCelebrationAudio();
    };
    document.addEventListener("pointerdown", prepare, true);
    document.addEventListener("click", prepare, true);
    document.addEventListener("keydown", prepare, true);
    return () => {
      document.removeEventListener("pointerdown", prepare, true);
      document.removeEventListener("click", prepare, true);
      document.removeEventListener("keydown", prepare, true);
      stopCelebrationSound();
    };
  }, []);

  // One delegated binding for the whole document. It covers nodes React
  // mounts later, so route changes need no re-binding, and hands back its
  // own undo.
  useEffect(() => bind(), []);

  // A floor under `bind()`: every control that nobody tagged still answers.
  //
  // The app has ~150 raw `<button>` elements — icon actions in table rows,
  // close buttons, menu items, Radix triggers — that never went through the
  // `Button` component and so carry no `data-cuelume-*` attribute. Tagging
  // each by hand is a large diff that goes stale the moment someone adds a
  // button, so the default lives here instead, delegated the way cuelume does
  // it and following the same gesture rules: a mouse presses on pointerdown
  // and lets go on the click, touch and pen play whole on the click (so a
  // scroll that starts on a row stays silent), a key plays both at once.
  //
  // It listens on `window` in the capture phase, ahead of `bind()` on the
  // document and of React's own handlers, so a menu trigger still reads
  // `aria-expanded="false"` on the press that is about to open it.
  useEffect(() => {
    // Read on every pointerdown, played there only for a mouse: Radix opens
    // menus and selects on pointerdown for touch too, so by the click a
    // finger's trigger already says `aria-expanded="true"`.
    let pressed: { element: HTMLElement; cue: FloorCue; input: "mouse" | "touch" | "pen" } | null = null;

    const control = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      // `bind()` decides for anything inside a tagged element, the same
      // innermost-wins rule it applies to its own attributes.
      if (target.closest(TAGGED)) return null;
      const element = target.closest<HTMLElement>(CONTROL);
      if (!element) return null;
      if (element.matches(":disabled,[aria-disabled='true']")) return null;
      return element;
    };

    const onPointerDown = (event: PointerEvent) => {
      pressed = null;
      if (event.button > 0) return;
      const element = control(event);
      if (!element) return;
      const input = event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse";
      pressed = { element, cue: floorCue(element), input };
      if (input !== "mouse") return;
      lastPressCue.current = { at: performance.now(), name: pressed.cue.name };
      press(pressed.cue.name, { ...pressed.cue.options, input });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      const tagged = target instanceof Element ? target.closest(TAGGED) : null;
      if (tagged) {
        const attribute = Object.keys(TAG_CUES).find((name) => tagged.hasAttribute(name));
        if (attribute) lastPressCue.current = { at: performance.now(), name: TAG_CUES[attribute] };
        return;
      }
      const element = control(event);
      if (!element) return;
      const held = pressed?.element === element ? pressed : null;
      pressed = null;
      const cue = held?.cue ?? floorCue(element);
      lastPressCue.current = { at: performance.now(), name: cue.name };
      if (held?.input === "mouse") {
        release(cue.name);
        return;
      }
      // A finger or pen plays whole here; no pointer at all is Enter or Space.
      play(cue.name, { ...cue.options, input: held?.input ?? (event.detail === 0 ? "keyboard" : "mouse") });
    };

    const onCancel = () => (pressed = null);

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointercancel", onCancel, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    preferences.current.enabled = next;
    setLibEnabled(next);
    if (!next) stopCelebrationSound();
    setEnabledState(next);
    try {
      localStorage.setItem(ENABLED_KEY, next ? "1" : "0");
    } catch {
      // Best-effort.
    }
    // Confirm the change with the thing being changed — silence on unmute
    // reads as broken.
    //
    // The library has to be told here rather than left to the effect below:
    // the effect only runs after this render commits, so `play` would still
    // be hitting the engine's `enabled === false` gate and the very
    // confirmation this exists for would be the one that never sounds.
    if (next) {
      void unlock();
      prepareCelebrationAudio();
      play("success");
    }
  }, []);

  const setVolume = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(1, Math.max(0, next));
    preferences.current.volume = clamped;
    setLibVolume(clamped);
    if (clamped === 0) stopCelebrationSound();
    setVolumeState(clamped);
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      // Best-effort.
    }
  }, []);

  const setTheme = useCallback((next: SoundTheme) => {
    if (!isTheme(next)) return;
    setLibTheme(next);
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Best-effort.
    }
  }, []);

  const cue = useCallback((name: CueName, options?: CueOptions) => {
    const { enabled, volume } = preferences.current;
    if (!enabled || volume === 0) return;
    if (name === "celebration") {
      playCelebration(volume);
      return;
    }
    const { unlessPressedWithin, unlessPressedAs, ...playOptions } = options ?? {};
    const last = lastPressCue.current;
    const announced =
      unlessPressedWithin !== undefined &&
      performance.now() - last.at < unlessPressedWithin &&
      (unlessPressedAs === undefined || unlessPressedAs === last.name);
    if (announced) return;
    play(name, playOptions);
  }, []);

  const value = useMemo<SoundContextValue>(
    () => ({ enabled, volume, theme, setEnabled, setVolume, setTheme, cue }),
    [enabled, volume, theme, setEnabled, setVolume, setTheme, cue],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

/**
 * Sound controls. Safe outside the provider — `cue` becomes a no-op rather
 * than throwing, so a component can ask for a sound without caring whether
 * it's mounted inside the shell.
 */
export function useSound(): SoundContextValue {
  const context = useContext(SoundContext);
  return (
    context ?? {
      enabled: false,
      volume: DEFAULT_VOLUME,
      theme: DEFAULT_THEME,
      setEnabled: () => {},
      setVolume: () => {},
      setTheme: () => {},
      cue: () => {},
    }
  );
}
