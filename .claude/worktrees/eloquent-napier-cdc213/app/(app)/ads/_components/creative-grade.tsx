"use client";

import type { ReactNode } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AlertDiamondIcon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import {
  RISK_THRESHOLD,
  SCORE_DIMENSIONS,
  SCORE_MAX,
  weakestDimension,
  type AdGrade,
  type ScoreDimension,
} from "@/lib/ad-grader-policy";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

// What the Creativos tab and the review drawer both draw for one grade. The
// rules come from lib/ad-grader-policy.ts — the same module the server graded
// with — so a bar here can never disagree with the verdict above it.

export type CreativeGrade = AdGrade;

/** Display order: the opening first, risk last and set apart. */
export const GRADE_DIMENSIONS: readonly ScoreDimension[] = SCORE_DIMENSIONS;

export const isRiskyScore = (value: number) => value >= RISK_THRESHOLD;

export const weakest = weakestDimension;

/** The Ads page prints money with a bare "$": the ad account carries the
 *  currency and nothing here reads it (see agent/tools/marketing.ts). */
export function formatCurrency(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}

/** A 0–1 ratio as a percentage with two decimals, the way Meta prints CTR. */
export function formatPercent(ratio: number): string {
  return `${((Number.isFinite(ratio) ? ratio : 0) * 100).toFixed(2)}%`;
}

/** The nine readings of one ad: seven bars and what to fix first. */
export function GradeBreakdown({ grade }: { readonly grade: CreativeGrade }) {
  const t = useT();
  const fix = weakest(grade.scores);
  const risky = isRiskyScore(grade.scores.claimRisk);
  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2">
        {GRADE_DIMENSIONS.map((dimension) => {
          const value = grade.scores[dimension];
          const isRisk = dimension === "claimRisk";
          return (
            <div className="flex items-center gap-3 text-xs" key={dimension}>
              <span className="w-28 shrink-0 truncate text-muted-foreground">{t(`ads.creatives.dim.${dimension}`)}</span>
              <div
                aria-label={`${t(`ads.creatives.dim.${dimension}`)}: ${value.toFixed(1)} / ${SCORE_MAX}`}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                role="img"
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    isRisk ? (risky ? "bg-amber-500" : "bg-foreground/25") : "bg-foreground/50",
                  )}
                  style={{ width: `${(value / SCORE_MAX) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums">{value.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
      {risky ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed">
          <span className="font-medium">{t("ads.creatives.riskTitle")}</span> {t("ads.creatives.riskBody")}
        </p>
      ) : null}
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed">
        <span className="font-medium">{t("ads.creatives.fixTitle", { dimension: t(`ads.creatives.dim.${fix}`) })}</span>{" "}
        {t(`ads.creatives.tip.${fix}`)}
      </p>
    </div>
  );
}

/** One line of a reading: a check for what works, a diamond for a risk. */
export function Finding({ children, tone }: { readonly children: ReactNode; readonly tone: "good" | "risk" | "neutral" }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed">
      <HugeiconsIcon
        className={cn(
          "mt-0.5 shrink-0",
          tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "risk" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
        icon={tone === "risk" ? AlertDiamondIcon : CheckmarkCircle02Icon}
        size={16}
        strokeWidth={1.75}
      />
      <span>{children}</span>
    </li>
  );
}
