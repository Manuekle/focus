import type { ReactNode } from "react";

export type ChartTone = "critical" | "neutral" | "positive" | "warning";
export type RankedBar = {
  readonly key: string;
  readonly label: ReactNode;
  readonly formatted: string;
  readonly value: number;
  readonly tone?: ChartTone;
  /** Optional numeric formatter lets the value animate without losing units. */
  readonly formatValue?: (value: number) => string;
};
export type TimePoint = { readonly key: string; readonly label: string; readonly value: number };

export const toneColor = (tone: ChartTone = "neutral") => ({
  neutral: "#2563EB", positive: "#059669", critical: "#E11D48", warning: "#D97706",
})[tone];
