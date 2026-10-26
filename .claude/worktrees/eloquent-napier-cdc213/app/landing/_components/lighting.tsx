"use client";

import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { cn } from "@/lib/utils";

/**
 * The lighting rig.
 *
 * The landing was a correctly built dark page with nothing switched on: one
 * bloom behind the hero headline at seven per cent, and every other surface
 * separated from the page by a hairline and a one-step change of grey. Cards
 * sat *on* the ground rather than above it; five screenshots ended in a veil
 * with no light having ever fallen across them; the closing section's bolt
 * icon — the page's one literal light source — was a grey glyph in a grey box.
 *
 * These are the fixtures. The rule they all obey is that the page has ONE
 * light, hanging above it: every cone opens downward, every metallic ramp is
 * bright at the cap line and dark at the baseline, and every pool sits under
 * the thing that is lit rather than beside it. Fixtures that each chose their
 * own direction would be a pile of effects; ones that agree are a room.
 *
 * Two pieces that used to live here are gone, and both for the same reason —
 * they were the ones that did not obey it. A cursor-tracking radial is a light
 * with no fixture, aimed from wherever the reader's hand happens to be. Four
 * corner brackets around the hero screenshot were not light at all: a fifth
 * kind of edge on a window that already had four, reading as crop marks. The
 * notes at their old addresses in `globals.css` have the detail.
 *
 * The CSS is in `globals.css` under "Lighting", where the light/dark inversion
 * and the reasons for gradients-over-filters are set out. What lives here is
 * only the markup each fixture needs and where the caller is allowed to point
 * it.
 *
 * ── What is deliberately not here ─────────────────────────────────────
 *
 * No colour. Every reference this was built from is monochrome or warm-white,
 * and the product has no accent hue anywhere in it — a coloured beam on a
 * page whose interface is neutral is a brand the app does not have, and the
 * `.lp-glow` note two files over already made that call once.
 *
 * No animation. Not one fixture loops, and none of them tracks anything. A
 * light that pulses is a notification; a light that holds still is a room.
 */

// ── Strip light ─────────────────────────────────────────────────────

/**
 * A tube light hung above something: the filament, the bloom around it, and
 * the cone it throws down.
 *
 * The caller positions it — `className` gets the Tailwind that says where it
 * hangs and how wide it is, because where a lamp goes is a composition
 * decision and not this component's. What it will not let you do is aim it:
 * there is no `direction` prop, and there will not be one. Two strip lights
 * pointing different ways on one page is two light sources, which is the thing
 * the whole rig exists to avoid.
 */
export function LightBar({
  className,
  drop = "18rem",
  gap = "20px",
  intensity = 1,
  style,
}: {
  /**
   * Where the box goes, and the box goes on the top edge of the thing being
   * lit — `top-0` of the object, not above it. The tube lifts itself out by
   * `gap`; the cone starts at the object's own face.
   *
   * Positioning the whole fixture above the object instead is the obvious
   * reading and it is wrong: the cone then starts above the object too, and
   * the strip of it that shows is the brightest part of the wash. On a
   * screenshot that is a smear along the top edge, on a pricing card a white
   * blob over the heading.
   */
  readonly className?: string;
  /** How far the cone reaches before it is gone. */
  readonly drop?: string;
  /** How far above the lit surface the tube hangs. */
  readonly gap?: string;
  /** One dial for the whole fixture. Above ~1.4 the cone starts to read as a
   *  grey panel rather than as light. */
  readonly intensity?: number;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("lp-beam", className)}
      style={
        {
          ...style,
          "--lp-beam-drop": drop,
          "--lp-beam-gap": gap,
          "--lp-beam-i": intensity,
        } as CSSProperties
      }
    >
      {/* Order is paint order: the cone is behind, the tube is on top of its
          own bloom. A filament under its glow reads as a smudge with a line
          in it. */}
      <span className="lp-beam-wash" />
      <span className="lp-beam-glow" />
      <span className="lp-beam-bar" />
    </div>
  );
}

// ── Spotlight ───────────────────────────────────────────────────────

/**
 * The same lamp with the fixture out of frame — a straight-sided cone opening
 * downward over a headline.
 *
 * Straight sides and not a radial, which is the whole difference between this
 * and `.lp-glow`: a beam has edges, and an ellipse behind a headline is light
 * that came from nowhere. The top of the cone belongs off screen or behind
 * something. A beam that starts in mid-air, with nothing above it, is a
 * gradient wearing a lamp's costume.
 */
export function Spotlight({
  className,
  intensity = 1,
  style,
}: {
  readonly className?: string;
  readonly intensity?: number;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("lp-spot", className)}
      style={{ ...style, "--lp-spot-i": intensity } as CSSProperties}
    />
  );
}

// ── Halo ────────────────────────────────────────────────────────────

/**
 * The pool of light a lit object leaves under itself. Sized and placed by the
 * caller; it is a gradient, so making it large costs a paint rather than a
 * filter pass.
 */
export function Halo({
  className,
  style,
}: {
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return <div aria-hidden="true" className={cn("lp-halo", className)} style={style} />;
}

// ── Glow mark ───────────────────────────────────────────────────────

/**
 * An icon that is the light source rather than a lit surface: the glyph
 * stacked at three blur radii over a radial that is only air.
 *
 * Four layers because that is what a bloom is. A `drop-shadow` is the
 * outermost of the four on its own, which is why an icon with a drop shadow
 * looks like an icon with a shadow and this looks like an icon that is on.
 *
 * The bloom is glyph-shaped near the glyph and round far from it — for free,
 * because every layer is the same icon and only the radius changes. Which
 * means it is worth spending on a mark whose silhouette says something (a
 * bolt, a key, a shield) and not worth it on a circle.
 */
export function GlowMark({
  className,
  icon,
  intensity = 1,
  size = 20,
  strokeWidth = 1.75,
}: {
  readonly className?: string;
  readonly icon: IconSvgElement;
  readonly intensity?: number;
  readonly size?: number;
  readonly strokeWidth?: number;
}) {
  const glyph = <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} />;

  return (
    <span
      className={cn("lp-glowmark", className)}
      style={{ "--lp-glowmark-i": intensity } as CSSProperties}
    >
      <span aria-hidden="true" data-layer="air" />
      <span aria-hidden="true" data-layer="far">
        {glyph}
      </span>
      <span aria-hidden="true" data-layer="near">
        {glyph}
      </span>
      <span data-layer="core">{glyph}</span>
    </span>
  );
}

// ── Polished type ───────────────────────────────────────────────────

/**
 * Type that has been milled rather than lit: a vertical metallic ramp through
 * the letterforms, with a blurred copy of the same word behind them.
 *
 * `text` is required even when `children` renders something else, because the
 * bloom is drawn with `content: attr(data-text)` — the component has to know
 * the word.
 *
 * ── It goes on the glyph, not around it ───────────────────────────────
 * A clipped background is painted by this element and masked by the text
 * inside it, so any descendant that composites on its own — an opacity below
 * 1, a filter, a `will-change` naming either — is painted outside that
 * operation and comes out invisible.
 *
 * So this wraps a *word*, and an animated figure is wrapped one character at
 * a time. `DigitPop`'s `luminous` mode does exactly that, and it is the only
 * caller that needs `children`: each character is its own ramp, its own bloom
 * and its own entrance. Since every digit is the same height, the per-glyph
 * ramps line up into one continuous one.
 *
 * Worth it on a figure and almost nothing else. A ramp through a headline is
 * a fifty-word paragraph of chrome; a ramp through `$29` is the number the
 * section is about, and the eye goes to it because it is the brightest thing
 * on the card.
 */
export function LuminousText({
  children,
  className,
  style,
  text,
}: {
  /** Defaults to `text`. Pass something else only when the word is already
   *  being rendered by another component. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** The word the bloom behind the letterforms is drawn from. */
  readonly text: string;
}) {
  return (
    <span className={cn("lp-lumen", className)} data-text={text} style={style}>
      {children ?? text}
    </span>
  );
}

// ── Brand glow ──────────────────────────────────────────────────────

/**
 * A full-colour mark, lit in its own colour.
 *
 * The one hue the rig allows, and it is not the rig inventing one — the
 * channel logos are already the exception this page makes, and they were the
 * only bright objects on a lit page throwing no light of their own. A green
 * WhatsApp bubble that casts nothing is a sticker; one with a green bloom
 * under it is in the room.
 *
 * `colour` is the mark's own brand value, passed by the caller rather than
 * sampled: an SVG with three gradients in it has no single colour, and picking
 * one is an editorial decision (Instagram's is the magenta at the middle of
 * its ramp, not the orange at the end, because magenta is the one people
 * name).
 *
 * The child has to contain an `<svg>` — `.lp-brand-glow svg` is what carries
 * the drop-shadows. A descendant selector rather than a child one, because the
 * payments connector is two marks side by side in a span.
 */
export function BrandGlow({
  children,
  className,
  colour,
  intensity = 1,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  /** Any CSS colour. Brand values, so hex is the honest form here. */
  readonly colour: string;
  /**
   * A dial on top of the theme's own. It multiplies rather than replaces,
   * because the light/dark difference is not the caller's to override — a
   * brand bloom has to be driven harder on white than on black whatever this
   * mark is doing.
   *
   * Used to put a mark further away rather than to make it dimmer: the channel
   * row is the section's whole claim, the connector marks under the automation
   * figure are a footnote, and they run at a third.
   */
  readonly intensity?: number;
}) {
  return (
    <span
      className={cn("lp-brand-glow", className)}
      style={{ "--lp-brand": colour, "--lp-brand-k": intensity } as CSSProperties}
    >
      {children}
    </span>
  );
}
