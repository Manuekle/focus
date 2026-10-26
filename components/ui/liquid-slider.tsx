"use client";

import { Liquid } from "liquid-gooey";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "../../lib/utils";

/** `useLayoutEffect` that stays quiet during SSR, where it never runs. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Painted thumb, px — a stadium like the switch's, not a circle. The native
 *  range thumb is sized to `THUMB_W` in CSS so the browser's value→position
 *  mapping equals the one below. */
const THUMB_W = 20;
const THUMB_H = 12;

/** A move bigger than this isn't a drag — it's a click on the far end of the
 *  track, or a keyboard jump. The liquid springs after the thumb, so over that
 *  distance the goo can't bridge the gap and you see the blob flying across as
 *  a second thumb. Past this, the surface is re-seeded at the new spot. */
const JUMP_PX = 40;

/** Track height, px. */
const TRACK_H = 6;

/**
 * Range slider whose thumb is a liquid blob: it lags the drag, stretches with
 * speed and pulls a droplet tail behind it (liquid-gooey `move`).
 *
 * The real `<input type="range">` sits invisible on top and stays the source
 * of truth — keyboard, pointer capture, and assistive tech all keep working;
 * everything under it is decoration driven off `value`.
 */
export function LiquidSlider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  label,
  className,
}: {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  /** Accessible name — the track carries no text. */
  readonly label: string;
  readonly className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // The thumb's travel is in px, so the track has to be measured — and
  // re-measured, since it's a fluid `max-w` box inside a card.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const span = max - min || 1;
  const fraction = Math.min(1, Math.max(0, (value - min) / span));
  const x = Math.max(0, width - THUMB_W) * fraction;

  // Remounting the group restarts its spring at the current position, which is
  // exactly what a jump wants: the thumb appears where it was clicked instead
  // of a blob chasing it across the track.
  const [seed, setSeed] = useState(0);
  const lastX = useRef(x);
  // Before paint: as a passive effect this re-seeds a frame late, and that one
  // frame is exactly the flash of a detached blob it exists to prevent.
  useIsomorphicLayoutEffect(() => {
    if (Math.abs(x - lastX.current) > JUMP_PX) setSeed((n) => n + 1);
    lastX.current = x;
  }, [x]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "liquid-slider relative h-6 w-full touch-none select-none",
        disabled && "opacity-40",
        className,
      )}
      style={{ "--slider-thumb-size": `${THUMB_W}px` } as CSSProperties}
    >
      {/* Track — same two greys as the switch, so a white thumb reads against
          both the filled and the empty half. */}
      <div
        className="pointer-events-none absolute top-1/2 left-0 w-full -translate-y-1/2 rounded-full"
        style={{
          height: TRACK_H,
          background: "var(--switch-off)",
          boxShadow: "var(--shadow-inset)",
        }}
      />
      {/* Filled portion — stops at the thumb's centre so the two read as one. */}
      <div
        className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 rounded-full"
        style={{
          height: TRACK_H,
          background: "var(--switch-on)",
          width: `${x + THUMB_W / 2}px`,
        }}
      />

      {/* Liquid thumb. Held back until the track has been measured, so it
          doesn't spring in from x=0 on first paint. */}
      {width > 0 ? (
        <Liquid
          key={seed}
          blur={4.5}
          contrast={16}
          fill="#fff"
          className="pointer-events-none"
          style={{ position: "absolute", inset: 0 }}
        >
          <Liquid.Item effect="move" move={{ springiness: 0.5, trail: 0.35 }}>
            {/* White, like the liquid group's fill: a different colour here
                would draw the trailing blob as a second, off-colour thumb. */}
            <div
              style={{
                position: "absolute",
                top: `calc(50% - ${THUMB_H / 2}px)`,
                left: 0,
                width: THUMB_W,
                height: THUMB_H,
                borderRadius: 999,
                background: "#fff",
                boxShadow: "var(--switch-thumb-shadow)",
                willChange: "transform",
                transform: `translateX(${x}px)`,
              }}
            />
          </Liquid.Item>
        </Liquid>
      ) : null}

      <input
        type="range"
        className="liquid-slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onValueChange(Number(e.target.value))}
      />
    </div>
  );
}
