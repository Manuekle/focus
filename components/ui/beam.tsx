"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { useTheme } from "../theme-provider";

export type BeamSize = "sm" | "md" | "line" | "pulse-inner" | "pulse-outside";
export type BeamVariant = "colorful" | "mono" | "ocean" | "sunset";

/**
 * The metallic look, per theme.
 *
 * `border-beam` ships four fixed palettes and no way to pass colors, so the
 * metal is mixed out of what it does expose: pick the palette whose hues sit
 * closest to the metal we want, crush `saturation` until the color reads as a
 * tint on gray rather than as a color, push `brightness` to get the sheen, and
 * nudge the whole thing with `--beam-hue-base` — a custom property the
 * package's own `filter` chains read, so setting it re-tints every layer
 * without clobbering their blur.
 *
 * Dark gets cool platinum: bright, blue-grey, high sheen against near-black.
 * Light gets warm graphite: a champagne cast, dimmer, so it stays legible as
 * an edge on a white card instead of washing out.
 */
const METAL = {
  dark: {
    colorVariant: "ocean" as BeamVariant,
    hueBase: "-12deg",
    saturation: 0.3,
    brightness: 1.5,
    strengthScale: 1,
  },
  light: {
    colorVariant: "sunset" as BeamVariant,
    hueBase: "-8deg",
    saturation: 0.5,
    brightness: 0.9,
    // A bloom on a white ground has far less contrast to work with than one on
    // near-black, so light mode spends more of the strength budget to land at
    // the same visual weight.
    strengthScale: 1.45,
  },
} as const;

export interface BeamProps {
  readonly children: ReactNode;
  /**
   * `pulse-outside` is the house default — it blooms past the control instead
   * of tracing it, which is the only variant that reads at button scale. It
   * needs an opaque child with its own 1px border, and room to spill: the halo
   * sits behind the content and is clipped by any `overflow: hidden` ancestor.
   */
  readonly size?: BeamSize;
  /** Overrides the metal for this instance. */
  readonly colorVariant?: BeamVariant;
  /** 0–1. Buttons sit low so the beam reads as a tint, not a light show. */
  readonly strength?: number;
  readonly active?: boolean;
  /** Only needed when the wrapper's first child hides its own radius. */
  readonly borderRadius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * Forces the metal, for a surface that does not follow the app's theme — a
   * panel pinned to one scheme, or a preview of the other. Nothing needs it
   * today; `useTheme()` is right everywhere the beam currently appears.
   */
  readonly theme?: "dark" | "light";
}

/**
 * The app's one entry point to `border-beam`.
 *
 * It exists so four things stay consistent everywhere the beam shows up: the
 * metal palette above; the package's own `theme="auto"`, which reads
 * `prefers-color-scheme` and is the wrong source here (the toggle in
 * theme-provider writes a `dark` class and persists it, so a forced theme
 * would desync); the rotate presets leaving `prefers-reduced-motion` to the
 * consumer; and the size default.
 *
 * `BorderBeam` renders a wrapper `<div>` around the child, so anything
 * positional has to move off the child and onto the wrapper. Pass placement
 * through `style`, not `className`: the package pins the wrapper to
 * `position: relative` from a stylesheet it injects after Tailwind's, and on
 * equal specificity the later rule wins — an inline style is what outranks it.
 */
export function Beam({
  children,
  size = "pulse-outside",
  colorVariant,
  strength = 0.55,
  active = true,
  borderRadius,
  className,
  style,
  theme: forcedTheme,
}: BeamProps) {
  const { theme } = useTheme();
  // Reduced motion fades the beam out rather than unmounting it: the wrapper
  // carries layout in most call sites, so removing it would move the control.
  const reduce = useReducedMotion();
  // `BorderBeam` renders its CSS into an inline <style>, so the resolved theme
  // is part of the markup React diffs on hydration — and the server always
  // resolves "light" while the client reads a persisted "dark" off the html
  // class. The first client render has to match the server's, so the beam
  // stays light and idle until mount and picks up the real theme after.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A forced theme is a property of the surface, not of the visitor, so it
  // applies on the server render too — there is nothing to hydrate around.
  const resolved = forcedTheme ?? (mounted ? theme : "light");
  const metal = METAL[resolved];

  return (
    <BorderBeam
      size={size}
      colorVariant={colorVariant ?? metal.colorVariant}
      // `hueRange={0}`, not `staticColors`: both stop the cycle that made the
      // halos drift through green, but `staticColors` strips `hue-rotate` out
      // of the generated filters altogether, and with it the `--beam-hue-base`
      // hook the metal is tuned on. A zero-width range keeps the hook and
      // parks the animation on a single angle.
      hueRange={0}
      saturation={metal.saturation}
      brightness={metal.brightness}
      strength={Math.min(1, strength * metal.strengthScale)}
      theme={resolved}
      active={mounted && active && !reduce}
      borderRadius={borderRadius}
      className={className}
      // A plain block wrapper leaves the line box's descender space under an
      // inline-flex control and floats the ring off its bottom edge. Shrink-
      // wrapping fixes the fit; a caller can still override it. Inside a flex
      // row the wrapper also stretches to the tallest item, so those call sites
      // add `self-center` to keep the ring on the control's own edge.
      style={
        {
          display: "inline-flex",
          "--beam-hue-base": metal.hueBase,
          ...style,
        } as CSSProperties
      }
    >
      {children}
    </BorderBeam>
  );
}
