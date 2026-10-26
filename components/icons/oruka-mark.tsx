"use client";

import { useId } from "react";
import { appIconSvg, MARK_VIEWBOX, markMaskSvg, ORCA_PATH } from "../../lib/app-icon";
import { cn } from "../../lib/utils";

/**
 * The bare mark, at the size the product shows it: 13px on the licence card.
 * Everywhere else — header, sidebar, login, announcements, the landing — shows
 * the app icon instead (`OrukaTile` below).
 *
 * Dark ink on a light ground only. Its white is cut out, so lit on a dark
 * ground the chest turns dark and the orca reads as its own negative; a dark
 * ground takes `OrukaTile`.
 *
 * ── The outline, with the white cut out of it ─────────────────────────
 * The orca is its outline masked by its white — the eye patch, the eye and the
 * chest (`markMaskSvg`) — so the ground shows through there whatever the fill
 * is — `currentColor`, the milled ramp, anything. The same drawing, filled
 * black, is `public/logos/oruka.svg`.
 *
 * ── The viewBox is the ink, not the canvas ────────────────────────────
 * `MARK_VIEWBOX` is the path's own bounding box, so a caller sizing this by
 * its box is sizing the mark and not a margin around it: `h-5` is five units
 * of orca.
 *
 * ── `metal` ──────────────────────────────────────────────────────────
 * The same milled ramp `LuminousText` puts through a figure, as an SVG
 * gradient: bright at the cap line, falling to the baseline, on the tokens the
 * rest of the rig already reads. It is a gradient and not a filter because the
 * mark is one path — there is nothing to bloom *from* except its own fill.
 *
 * It replaces `currentColor`, so it is opt-in. A lockup on the page ground —
 * the footer — takes `metal`; a mark on a ground of the *opposite* polarity
 * (a `--foreground` chip) takes `metal="inverted"`, the same ramp read off
 * `--lp-lumen-inv-*`, because the page-ground ramp would paint a near-black
 * mark into a near-black chip. Flat next to milled is the one combination
 * that reads as a mistake rather than as a choice.
 *
 * ── Width is auto, and that is not a detail ───────────────────────────
 * The mark is 1217 × 1085, about 1.12 wide for its height. Pinning both axes
 * to any pair of numbers that is not that ratio squashes it. With one axis
 * set and the other `auto`, the browser takes the ratio off the viewBox and
 * it cannot drift. Set height; leave width alone.
 */
export function OrukaMark({
  className,
  metal = false,
}: {
  readonly className?: string;
  /**
   * Mill the mark instead of filling it with `currentColor`. `"inverted"`
   * mills it for a ground that runs against the page's — a `--foreground`
   * tile, a chip, anywhere the mark would otherwise be `text-background`.
   */
  readonly metal?: boolean | "inverted";
}) {
  /* Per instance. The mark renders two or three times on a page and an SVG
     `url(#id)` is resolved against the whole document, so a hardcoded id would
     have every copy painting from whichever `<defs>` happened to be first —
     fine while they are identical, and a silent bug the moment one is not.
     `brand-marks.tsx` has the same note and the scar to go with it. */
  const uid = useId();
  const gradientId = `oruka-metal-${uid}`;
  const maskId = `oruka-cut-${uid}`;

  /* Two token families, one ramp shape. Named rather than built by
     concatenating a prefix into `var(--lp-lumen-…)`: a custom property that
     only exists as a string is a custom property no search will find on the
     day someone renames it. */
  const ramp =
    metal === "inverted"
      ? { hi: "var(--lp-lumen-inv-hi)", lo: "var(--lp-lumen-inv-lo)", mid: "var(--lp-lumen-inv-mid)" }
      : { hi: "var(--lp-lumen-hi)", lo: "var(--lp-lumen-lo)", mid: "var(--lp-lumen-mid)" };

  return (
    <svg
      viewBox={MARK_VIEWBOX}
      aria-hidden="true"
      className={cn("h-5 w-auto shrink-0 text-foreground", className)}
      fill={metal ? `url(#${gradientId})` : "currentColor"}
    >
      {/* Static markup from `markMaskSvg`, nothing user-supplied. */}
      <defs dangerouslySetInnerHTML={{ __html: markMaskSvg(maskId) }} />
      {metal ? (
        <defs>
          {/* `objectBoundingBox` units, so the ramp spans the glyph rather than
              the viewBox — the two differ by the crop, and a ramp measured on
              the box would put its midtone in the wrong place. */}
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={ramp.hi} />
            <stop offset="22%" stopColor={ramp.hi} />
            <stop offset="58%" stopColor={ramp.mid} />
            <stop offset="100%" stopColor={ramp.lo} />
          </linearGradient>
        </defs>
      ) : null}
      <path d={ORCA_PATH} mask={`url(#${maskId})`} />
    </svg>
  );
}

/**
 * The app icon — the same drawing as the favicon and the install icons
 * (`lib/app-icon.ts`) — wherever the product shows its icon on its own:
 * header, sidebar, login, onboarding.
 *
 * Always the light appearance, on either theme. It used to be a
 * `--foreground` tile, which made it a black icon on a light page and a white
 * one on a dark page: two different icons, neither of them the one on the
 * visitor's home screen. Size it with the box (`size-7`, `size-12`); the tile
 * draws its own squircle, so no radius goes on the box.
 *
 * The drop shadow is the one thing the export does not carry — a home screen
 * draws its own — and it is what keeps a white tile from dissolving into a
 * white page.
 */
export function OrukaTile({ className }: { readonly className?: string }) {
  // Per instance: the icon's gradients and filters are found by id, and the
  // tile renders in more than one place on some pages.
  const id = `oruka-tile-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-8 shrink-0 [filter:drop-shadow(0_0.5px_1px_oklch(0_0_0/0.16))_drop-shadow(0_2px_5px_oklch(0_0_0/0.06))] [&>svg]:block [&>svg]:size-full",
        className,
      )}
      // Static markup from `appIconSvg`, nothing user-supplied.
      dangerouslySetInnerHTML={{ __html: appIconSvg({ id }) }}
    />
  );
}
