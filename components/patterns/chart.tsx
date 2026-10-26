"use client";

// Public chart API. Chat markdown/artifact renderers use their own chart layer.
export { RankedBars } from "./charts/ranked-bars";
export { TimeSeries } from "./charts/area-chart";
export { DonutChart } from "./charts/donut-chart";
export { StackedBars } from "./charts/stacked-bars";
export { AnimatedNumber, ChartPeriod, ChartSelector } from "./charts/primitives";
export type { ChartTone, RankedBar, TimePoint } from "./charts/types";
import type { ChartTone } from "./charts/types";

// Semantic colors remain available to non-chart indicators and status icons.
export const CHART_TONE_FILL: Readonly<Record<ChartTone, string>> = {
  critical: "bg-rose-500/70", neutral: "bg-blue-600/70", positive: "bg-emerald-500/70", warning: "bg-amber-500/70",
};
export const CHART_TONE_WASH: Readonly<Record<ChartTone, string>> = {
  critical: "bg-rose-500/20", neutral: "bg-blue-600/12", positive: "bg-emerald-500/20", warning: "bg-amber-500/20",
};
export const CHART_TONE_STROKE: Readonly<Record<ChartTone, string>> = {
  critical: "text-rose-500", neutral: "text-blue-600", positive: "text-emerald-500", warning: "text-amber-500",
};
