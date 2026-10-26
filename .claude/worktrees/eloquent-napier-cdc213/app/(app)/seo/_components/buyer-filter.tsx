"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import {
  buyerSummary,
  isBuyer,
  searchKey,
  type SearchJudgment,
} from "@/lib/seo-intent-policy";
import type { ComparedRow } from "@/lib/seo-metrics";
import type { SearchLabel } from "./seo-table";

// "Solo compradores" on the Búsquedas tab: which searches bring people who
// want to buy, read by Jev (lib/seo-intent.ts).
//
// Nothing is spent on a plain visit. The tab asks for the judgments already
// stored — free, and enough to label every search seen before — and only
// choosing "Solo compradores" asks Jev about the rest.

type IntentReply = {
  readonly ready: boolean;
  readonly judgments: Record<string, SearchJudgment>;
  readonly pending: number;
};

/** The request caps a call at 500 searches, which is also all the page reads. */
const MAX = 500;

export function useSearchIntents(rows: readonly ComparedRow[], enabled: boolean) {
  const t = useT();
  const [reply, setReply] = useState<IntentReply | null>(null);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const ask = useCallback(
    async (cachedOnly: boolean) => {
      const queries = rows.slice(0, MAX).map((row) => row.key);
      if (queries.length === 0) return;
      const result = await fetchJson<IntentReply>("/api/seo/intent", t, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries, cachedOnly }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setReply(result.data);
    },
    [rows, t],
  );

  useEffect(() => {
    if (enabled) void ask(true);
  }, [ask, enabled]);

  const judge = useCallback(async () => {
    setJudging(true);
    await ask(false);
    setJudging(false);
  }, [ask]);

  return {
    ready: reply?.ready ?? null,
    judgments: reply?.judgments ?? {},
    pending: reply?.pending ?? 0,
    judging,
    error,
    judge,
  };
}

/** Rows a buyer typed, when the filter is on; every row otherwise. */
export function filterBuyers(
  rows: readonly ComparedRow[],
  judgments: Readonly<Record<string, SearchJudgment>>,
  buyersOnly: boolean,
): readonly ComparedRow[] {
  return buyersOnly ? rows.filter((row) => isBuyer(judgments[searchKey(row.key)])) : rows;
}

/** The line under each search: "Quiere comprar", "Comparando"… */
export function searchLabels(
  rows: readonly ComparedRow[],
  judgments: Readonly<Record<string, SearchJudgment>>,
  t: (key: string) => string,
): Record<string, SearchLabel> {
  const labels: Record<string, SearchLabel> = {};
  for (const row of rows) {
    const judgment = judgments[searchKey(row.key)];
    if (!judgment) continue;
    const buyer = isBuyer(judgment);
    if (!buyer && judgment.intent === "other") continue;
    labels[row.key] = {
      buyer,
      text: t(buyer ? "seo.buyers.label" : `seo.buyers.intent.${judgment.intent}`),
    };
  }
  return labels;
}

/**
 * The control above the table: "Todas / Solo compradores", the share of clicks
 * that came from buyers, and — without a TypeSafe key — where to add one.
 */
export function BuyerFilter({
  buyersOnly,
  intents,
  onChange,
  rows,
}: {
  readonly buyersOnly: boolean;
  readonly intents: ReturnType<typeof useSearchIntents>;
  readonly onChange: (buyersOnly: boolean) => void;
  readonly rows: readonly ComparedRow[];
}) {
  const t = useT();
  if (intents.ready === null || rows.length === 0) return null;

  if (!intents.ready) {
    return (
      <p className="text-muted-foreground text-xs">
        {t("seo.buyers.needsKey")}{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/settings">
          {t("seo.buyers.needsKeyAction")}
        </Link>
      </p>
    );
  }

  const summary = buyerSummary(
    rows.map((row) => ({ key: row.key, clicks: row.current.clicks })),
    intents.judgments,
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <SlidingTabs
        onValueChange={(next) => {
          const on = next === "buyers";
          onChange(on);
          if (on && intents.pending > 0 && !intents.judging) void intents.judge();
        }}
        tabs={[
          { id: "all", label: t("seo.buyers.all") },
          { id: "buyers", label: t("seo.buyers.only") },
        ]}
        value={buyersOnly ? "buyers" : "all"}
      />
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        {intents.judging ? (
          <>
            <Spinner />
            {t("seo.buyers.judging", { count: Math.min(intents.pending, MAX) })}
          </>
        ) : summary.judged > 0 ? (
          t("seo.buyers.summary", {
            buyers: summary.buyers,
            judged: summary.judged,
            share: summary.clickShare === null ? "0%" : `${Math.round(summary.clickShare * 100)}%`,
          })
        ) : (
          t("seo.buyers.hint")
        )}
      </p>
    </div>
  );
}
