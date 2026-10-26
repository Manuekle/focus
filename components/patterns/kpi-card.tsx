"use client";

import { HugeiconsIcon, type IconSvgElement } from "../icons/icon";
import {
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
  MinusSignIcon,
} from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { AnimatedNumber, CHART_TONE_FILL, CHART_TONE_STROKE, type ChartTone } from "./chart";
import { Card } from "./dashboard-card";
import { cn } from "../../lib/utils";
import { MiniTrend } from "./charts/mini-trend";

/**
 * Shared metric tile: a quiet icon-and-label header above an inset metal plate.
 * The plate groups the value, its context and the metric's optional visual.
 * Surface tokens keep the same material in both light and dark themes.
 */

/* One set of colour roles for every mark in the product — a tile's meter and a
   card's chart have to mean the same thing by "warning". They live with the
   charts because that is where the roles are documented. */
type Tone = ChartTone;

const TONE_FILL = CHART_TONE_FILL;
const TONE_STROKE = CHART_TONE_STROKE;

// ── Delta ───────────────────────────────────────────────────────────

export type KpiDelta = {
  readonly direction: "down" | "flat" | "up";
  /** What the change is in — "Prompts", "vs. la semana pasada". */
  readonly label?: string;
  /**
   * Colour, when the direction is not the whole story. A latency that fell is
   * a direction of `down` and a tone of `positive`; leave it out and the tile
   * colours by direction, which is right for most counts.
   */
  readonly tone?: Tone;
  /** Pre-formatted, sign included: `+8.4%`. */
  readonly value: string;
};

const DIRECTION_ICON = {
  down: ArrowDownRight01Icon,
  flat: MinusSignIcon,
  up: ArrowUpRight01Icon,
} as const;

const DIRECTION_TONE: Readonly<Record<KpiDelta["direction"], Tone>> = {
  down: "critical",
  flat: "neutral",
  up: "positive",
};

function DeltaLine({ delta }: { readonly delta: KpiDelta }) {
  const tone = delta.tone ?? DIRECTION_TONE[delta.direction];
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      <HugeiconsIcon
        className={cn("shrink-0", TONE_STROKE[tone])}
        icon={DIRECTION_ICON[delta.direction]}
        size={13}
        strokeWidth={2}
      />
      <span className={cn("font-numeral font-medium tabular-nums", TONE_STROKE[tone])}>{delta.value}</span>
      {delta.label ? <span className="min-w-0 text-pretty text-muted-foreground [overflow-wrap:anywhere]">{delta.label}</span> : null}
    </p>
  );
}

// ── Visuals ─────────────────────────────────────────────────────────

/**
 * A fill meter drawn as discrete ticks.
 *
 * A solid progress bar reads as "loading"; a row of ticks reads as a gauge,
 * and it is legible at a glance at a fraction of a bar's visual weight.
 */
export function KpiBars({
  ratio,
  segments = 24,
  tone = "neutral",
}: {
  /** 0–1. Clamped, so a metric that overshoots its target fills and stops. */
  readonly ratio: number;
  readonly segments?: number;
  readonly tone?: Tone;
}) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * segments);
  return (
    <div aria-hidden="true" className="flex h-6 items-stretch gap-[3px]">
      {Array.from({ length: segments }, (_, i) => (
        <span
          className={cn("flex-1 rounded-full", i < filled ? TONE_FILL[tone] : "bg-muted")}
          key={i}
        />
      ))}
    </div>
  );
}

/**
 * A series, drawn as a line and nothing else — no axes, no grid, no dots. The
 * shape is the whole message; anything that would let you read a value off it
 * belongs on a chart, not on a tile.
 */
export function KpiSparkline({
  points,
  tone = "neutral",
}: {
  /** At least two values. Scaled to their own min and max. */
  readonly points: readonly number[];
  readonly tone?: Tone;
}) {
  if (points.length < 2 || points.every((value) => value === 0)) return <div className="h-6" />;
  return <MiniTrend points={points} tone={tone} />;
}

/**
 * A set of parts as one bar.
 *
 * For the tiles whose number is a count out of a whole — active against paused
 * against draft — where the useful thing is not the count but its share.
 */
export function KpiSplit({
  parts,
}: {
  readonly parts: readonly { readonly tone: Tone; readonly value: number }[];
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  // Ranked, so the ramp below lands on the parts in the order a reader cares
  // about them. Four campaigns arrive in whatever order the API listed them.
  const ranked = [...parts].sort((a, b) => b.value - a.value);
  return (
    <div aria-hidden="true" className="flex h-6 items-center">
      <div className="flex h-2 w-full gap-[3px]">
        {total === 0 ? (
          <span className="w-full rounded-full bg-muted" />
        ) : (
          ranked.map((part, i) => (
            <span
              className={cn(
                "rounded-full",
                part.tone === "neutral" ? "bg-foreground" : TONE_FILL[part.tone],
              )}
              key={i}
              style={{
                /* Neutral parts step down in weight rather than repeating one
                   grey. Equal-weight segments separated by gaps read as a
                   dashed line — four ticks that happen to be different
                   lengths — instead of as one quantity split four ways. */
                opacity: part.tone === "neutral" ? Math.max(0.14, 0.62 - i * 0.13) : undefined,
                width: `${(part.value / total) * 100}%`,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Tile ────────────────────────────────────────────────────────────

/** Every metric needs context below its value, either prose or a change. */
type KpiContext =
  | { readonly sub: string; readonly delta?: KpiDelta }
  | { readonly sub?: string; readonly delta: KpiDelta };

export function KpiCard({
  className,
  delta,
  icon,
  label,
  sub,
  value,
  visual,
}: {
  readonly className?: string;
  readonly icon: IconSvgElement;
  readonly label: string;
  /** This tile's own picture — `KpiBars`, `KpiSparkline`, `KpiSplit`, or any
   *  node. Tiles that have nothing worth drawing leave it out. */
  readonly visual?: ReactNode;
  readonly value: number | string;
} & KpiContext) {
  return (
    <Card className={cn("kpi-card", className)} interactive>
      <div className="kpi-header">
        <HugeiconsIcon aria-hidden="true" className="shrink-0 text-muted-foreground" icon={icon} size={16} strokeWidth={1.75} />
        <p className="min-w-0 text-pretty text-sm font-medium leading-5 [overflow-wrap:anywhere]">{label}</p>
      </div>

      <div className="kpi-body">
        <div className="kpi-plate">
          <p className="kpi-value font-numeral font-medium text-[32px] leading-none tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere]">
            {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
          </p>

          {delta ? (
            <DeltaLine delta={delta} />
          ) : sub ? (
            <p className="mt-2 text-pretty text-muted-foreground text-xs leading-4 [overflow-wrap:anywhere]">{sub}</p>
          ) : null}
        </div>

        {visual ? <div className="kpi-plate mt-auto pt-4">{visual}</div> : null}
      </div>
    </Card>
  );
}
