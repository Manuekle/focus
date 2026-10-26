"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  VoiceBeam as VoiceGlow,
  type VoiceBeamColorVariant,
  type VoiceBeamLevel,
} from "voice-glow";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { useTheme } from "../theme-provider";

export type VoiceBeamHost = "default" | "pill" | "mobile";

/**
 * The app's one entry point to `voice-glow` — the sound-reactive glow that
 * rises along the bottom edge of whatever it wraps.
 *
 * Same three reasons `components/ui/beam.tsx` exists for `border-beam`, and
 * the two packages share a family so the reasoning carries over:
 *
 * - `theme="auto"` reads `prefers-color-scheme`, which is the wrong source
 *   here: the toggle in theme-provider writes a `dark` class and persists it,
 *   so the OS setting and the app's can disagree.
 * - The package renders its stylesheet into the markup, so the resolved theme
 *   is part of what React diffs on hydration. The server always resolves
 *   "light"; the first client render has to match it and pick the real theme
 *   up after mount.
 * - `prefers-reduced-motion` is left to the consumer by the package, and this
 *   effect is nothing but motion — it fades out entirely under it.
 *
 * The house palette is neutral (`--primary` is grayscale), so the default here
 * is `mono` rather than the library's full-spectrum `colorful`, which is the
 * loudest thing on the surface by a distance. Pass `colorVariant` to bring a
 * palette back on a surface that wants one.
 */
export function VoiceBeamGlow({
  children,
  type = "default",
  stream,
  level,
  processing = false,
  active = true,
  colorVariant = "mono",
  strength,
  glowHeight,
  glowWidth,
  processingLevel,
  borderRadius,
  className,
  style,
  theme: forcedTheme,
}: {
  readonly children: ReactNode;
  /** Geometry preset: a composer/card, a recording pill, a phone's bottom edge. */
  readonly type?: VoiceBeamHost;
  /** Live microphone (or any WebRTC) audio the glow reacts to. */
  readonly stream?: MediaStream | null;
  /** Manual drive, 0–1, for a surface with no audio. A `stream` wins over it;
   *  a getter is sampled once a frame instead of re-rendering. */
  readonly level?: VoiceBeamLevel;
  /** Gathers the glow into one beam travelling its range while work is running. */
  readonly processing?: boolean;
  readonly active?: boolean;
  readonly colorVariant?: VoiceBeamColorVariant;
  /** 0–1 effect opacity. Left unset the package's per-theme default applies. */
  readonly strength?: number;
  readonly glowHeight?: number;
  readonly glowWidth?: number;
  readonly processingLevel?: number;
  /** Only needed when the wrapped child hides its own radius. */
  readonly borderRadius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Forces the palette for a surface pinned to one scheme. */
  readonly theme?: "dark" | "light";
}) {
  const { theme } = useTheme();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A forced theme is a property of the surface, not of the visitor, so it
  // applies on the server render too — there is nothing to hydrate around.
  const resolved = forcedTheme ?? (mounted ? theme : "light");

  return (
    <VoiceGlow
      type={type}
      stream={stream ?? null}
      processing={processing}
      glowHeight={glowHeight}
      glowWidth={glowWidth}
      processingLevel={processingLevel}
      {...(level === undefined ? {} : { level })}
      active={mounted && active && !reduce}
      colorVariant={colorVariant}
      theme={resolved}
      borderRadius={borderRadius}
      className={className}
      // The package pins its root to `position: relative` from a stylesheet
      // it injects after Tailwind's, so anything layout-shaped goes inline,
      // where it outranks an equal-specificity rule. The composer is a block
      // that fills its column; the wrapper has to do the same or the input
      // shrink-wraps inside it.
      style={{ display: "block", width: "100%", ...style }}
      {...(strength === undefined ? {} : { strength })}
    >
      {children}
    </VoiceGlow>
  );
}
