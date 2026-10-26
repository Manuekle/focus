"use client";

import * as React from "react";

/* -------------------------------------------------------------------------
 * Timing
 * ---------------------------------------------------------------------- */

/**
 * Solves a real CSS cubic-bezier. The previous inline "approximations" were
 * not bezier solutions at all — they were a bernstein polynomial evaluated on
 * the wrong axis, which is why the open never felt like the curve it named.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // Newton-Raphson first; it converges in a couple of steps on these curves.
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }

    // Bisection fallback for the flat-slope regions of (0.23, 1, 0.32, 1).
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const dx = sampleX(t);
      if (Math.abs(dx - x) < 1e-6) break;
      if (x > dx) lo = t;
      else hi = t;
      t = (hi - lo) / 2 + lo;
    }
    return sampleY(t);
  };
}

export const GOO_OPEN_MS = 190;
/** Close runs ~20% faster than open, on its own shorter curve — never the
 *  open curve reversed, and never an ease-in. */
export const GOO_CLOSE_MS = 150;

const EASE_OPEN = cubicBezier(0.23, 1, 0.32, 1);
const EASE_CLOSE = cubicBezier(0.25, 0.46, 0.45, 0.94);

export function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}

/**
 * The single progress value everything is derived from: 0 closed, 1 open.
 * No springs, no velocity term — one clock, so the trigger, the neck and the
 * sheet can never disagree about how far the drop has fallen.
 */
export function useGooProgress(open: boolean) {
  // Always starts closed, even when it mounts already open: a menu that Radix
  // mounts on open must still fall, not appear.
  const [p, setP] = React.useState(0);
  const pRef = React.useRef(0);
  const frameRef = React.useRef(0);

  React.useEffect(() => {
    const from = pRef.current;
    const to = open ? 1 : 0;
    if (from === to) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      pRef.current = to;
      setP(to);
      return;
    }

    const ease = open ? EASE_OPEN : EASE_CLOSE;
    // Interrupting mid-flight shortens the tween instead of replaying it whole.
    const duration = (open ? GOO_OPEN_MS : GOO_CLOSE_MS) * Math.abs(to - from);
    const start = performance.now();

    const tick = (now: number) => {
      const t = duration <= 0 ? 1 : clamp((now - start) / duration, 0, 1);
      const next = from + (to - from) * ease(t);
      pRef.current = next;
      setP(next);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
    // Depending on `p` here restarted the tween on every single frame, which is
    // why the old dropdowns crawled and never settled.
  }, [open]);

  return p;
}

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

export type GooShape = {
  p: number;
  /** Top edge of the sheet, px from the top of the trigger. Peels, then stops. */
  topEdge: number;
  /** Height, defined DIRECTLY. Never bottom-minus-top: two independent edges
   *  can cross and clamp the sheet to a thin line. */
  height: number;
  radius: number;
};

export type GooShapeOptions = {
  triggerHeight?: number;
  panelHeight?: number;
  topFrom?: number;
  topTo?: number;
  heightFrom?: number;
  radiusFrom?: number;
  radiusTo?: number;
};

export function gooShape(p: number, options: GooShapeOptions = {}): GooShape {
  const {
    panelHeight = 146,
    topFrom = 20,
    topTo = 48,
    heightFrom = 12,
    radiusFrom = 6,
    radiusTo = 8,
  } = options;

  // The top edge peels fast and stops at 45% of the timeline...
  const peel = clamp(p / 0.45, 0, 1);
  const topEdge = lerp(topFrom, topTo, easeOutQuad(peel));

  // ...while the body keeps filling through the detach and past it, so at the
  // moment the neck snaps the sheet is already most of its height.
  // The sheet is the trigger's own width the whole way, so it is never a
  // droplet: height is linear in p and the radius is nailed to p.
  const height = lerp(heightFrom, panelHeight, p);
  const radius = lerp(radiusFrom, radiusTo, p);

  // The neck is not drawn. The sheet's top edge starts inside the trigger and
  // walks out of it, so the goo's own blur holds the two together across a gap
  // that grows from 0 to 8px and then fails the threshold: that thinning and
  // that snap ARE the neck. A drawn one fights the blur and leaves hard
  // shoulders where the two disagree.
  return { p, topEdge, height, radius };
}

/**
 * Reveal for one menu item, keyed to the sheet's own growth rather than the
 * raw clock — an item can never appear before the panel has grown to hold it.
 */
export function gooItemReveal(height: number, itemTop: number, itemHeight: number) {
  // The item starts appearing exactly when the sheet reaches its top edge and
  // is fully there when the sheet reaches its bottom. Any ramp that finishes
  // later leaves the LAST item stuck part-faded forever, because the sheet's
  // final height is precisely that item's bottom.
  return clamp((height - itemTop) / Math.max(itemHeight, 1), 0, 1);
}

/* -------------------------------------------------------------------------
 * Filter
 * ---------------------------------------------------------------------- */

/**
 * Blur, then a hard alpha threshold, so overlapping shapes read as one body of
 * water. The grey ring is derived from the MERGED silhouette — erode the
 * thresholded shape by 1px and flood the difference — so a single continuous
 * outline wraps the trigger, runs down the neck and closes around the sheet.
 * It is never drawn on either element.
 *
 * Nothing with text in it may be fed through this filter: the blur plus the
 * threshold turns glyphs into ghosts and a box-shadow into a hard black slab.
 */
export function GooFilterDefs({
  id,
  blur = 4.5,
  outline = "var(--goo-outline)",
}: {
  id: string;
  blur?: number;
  outline?: string;
}) {
  return (
    <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
      <defs>
        <filter
          id={id}
          colorInterpolationFilters="sRGB"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blurred" />
          <feColorMatrix
            in="blurred"
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 18 -7"
            result="merged"
          />
          <feMorphology in="merged" operator="erode" radius="1" result="body" />
          <feComposite in="merged" in2="body" operator="out" result="rim" />
          <feFlood style={{ floodColor: outline }} result="rimInk" />
          <feComposite in="rimInk" in2="rim" operator="in" result="ring" />
          <feMerge>
            <feMergeNode in="body" />
            <feMergeNode in="ring" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * Surface
 * ---------------------------------------------------------------------- */

const SURFACE_PAD = 24;

export type GooSurfaceProps = {
  shape: GooShape;
  filterId: string;
  /** Trigger box, in the surface's own coordinates (0,0 = top-left of trigger row). */
  triggerLeft?: number;
  triggerTop?: number;
  triggerWidth: number;
  triggerHeight: number;
  triggerRadius?: number;
  /** Square off the twin's top corners, for a lip drawn along a trigger's
   *  bottom edge rather than a twin of the whole trigger. */
  triggerLip?: boolean;
  /** Sheet box. Defaults to the trigger's own width, centred on it. */
  sheetLeft?: number;
  sheetWidth?: number;
  /** Flip the whole body so the sheet falls upward out of the trigger. */
  flip?: boolean;
  fill?: string;
  className?: string;
};

/**
 * The liquid itself: a twin of the trigger's body plus the sheet, both fed
 * through ONE goo filter so the sheet is torn off the trigger rather than slid
 * out from behind it. Purely shapes — the real trigger's fill and text, and the
 * menu's items, sit opaque on top of this and outside the filter.
 *
 * The shadow rides twins OUTSIDE the filter, because a box-shadow pushed
 * through the threshold would come back as a hard slab.
 */
export function GooSurface({
  shape,
  filterId,
  triggerLeft = 0,
  triggerTop = 0,
  triggerWidth,
  triggerHeight,
  triggerRadius = 11,
  triggerLip = false,
  sheetLeft,
  sheetWidth,
  flip = false,
  fill = "var(--popover)",
  className,
}: GooSurfaceProps) {
  const { topEdge, height, radius } = shape;

  const sheetW = sheetWidth ?? triggerWidth;
  const sheetX = sheetLeft ?? triggerLeft + (triggerWidth - sheetW) / 2;

  // The filter region is derived from this element's own box, so the box has to
  // cover the whole union or the sheet gets cut off mid-fall.
  const left = Math.min(triggerLeft, sheetX) - SURFACE_PAD;
  const right = Math.max(triggerLeft + triggerWidth, sheetX + sheetW) + SURFACE_PAD;
  const bottom =
    Math.max(triggerTop + triggerHeight, topEdge + height) + SURFACE_PAD;

  const trigger: React.CSSProperties = {
    position: "absolute",
    left: triggerLeft - left,
    top: SURFACE_PAD + triggerTop,
    width: triggerWidth,
    height: triggerHeight,
    borderRadius: triggerLip
      ? `0 0 ${triggerRadius}px ${triggerRadius}px`
      : triggerRadius,
  };

  const sheet: React.CSSProperties = {
    position: "absolute",
    left: sheetX - left,
    top: SURFACE_PAD + topEdge,
    width: sheetW,
    height,
    borderRadius: radius,
  };

  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        left,
        top: flip ? undefined : -SURFACE_PAD,
        bottom: flip ? -SURFACE_PAD : undefined,
        width: right - left,
        height: bottom + SURFACE_PAD,
        pointerEvents: "none",
      }}
    >
      {/* Shadow twins — OUTSIDE the flip transform so box-shadow always falls
          downward. When triggerLip is set the trigger twin is just a thin lip
          inside the host element's padding, and its shadow would float over the
          host's own border; skip it. Opacity is tied to p so the shadow fades
          in with the drop rather than popping on the first frame. */}
      {!triggerLip ? (
        <div
          style={{
            ...trigger,
            top: flip ? undefined : trigger.top,
            bottom: flip
              ? bottom + SURFACE_PAD - ((trigger.top as number) + triggerHeight)
              : undefined,
            boxShadow: "var(--shadow-float)",
          }}
        />
      ) : null}
      <div
        style={{
          ...sheet,
          top: flip ? undefined : sheet.top,
          bottom: flip
            ? bottom + SURFACE_PAD - ((sheet.top as number) + height)
            : undefined,
          boxShadow: "var(--shadow-float)",
          opacity: shape.p,
        }}
      />

      {/* One filter, one body of water — this layer flips for upward panels. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: `url(#${filterId})`,
          transform: flip ? "scaleY(-1)" : undefined,
          transformOrigin: "center",
        }}
      >
        <div style={{ ...trigger, background: fill }} />
        <div style={{ ...sheet, background: fill }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Items
 * ---------------------------------------------------------------------- */

/**
 * Fades each item in against the sheet's own growth rather than the raw clock,
 * so an item can never appear before the panel has grown to hold it.
 */
export function GooItems({
  height,
  children,
  className,
}: {
  height: number;
  children: React.ReactNode;
  className?: string;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = React.useState<Array<{ top: number; height: number }>>([]);
  const childCount = React.Children.count(children);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const next = Array.from(list.children).map((child) => {
        const el = child as HTMLElement;
        return { top: el.offsetTop, height: el.offsetHeight };
      });
      setMetrics((prev) =>
        prev.length === next.length &&
        prev.every((m, i) => m.top === next[i].top && m.height === next[i].height)
          ? prev
          : next,
      );
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [childCount]);

  return (
    <div ref={listRef} className={className}>
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        const metric = metrics[index];
        return (
          <div style={{ opacity: metric ? gooItemReveal(height, metric.top, metric.height) : 0 }}>
            {child}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Measures the box a goo surface tears out of — the real trigger, which for the
 * chat panels is the input shell itself rather than a button.
 */
export function useHostBox(ref: React.RefObject<HTMLElement | null>) {
  const [box, setBox] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setBox((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [ref]);

  return box;
}
