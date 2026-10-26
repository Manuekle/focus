"use client";

import { useState } from "react";
import { BuyerFilter, filterBuyers, searchLabels, useSearchIntents } from "@/app/(app)/seo/_components/buyer-filter";
import { SeoTable } from "@/app/(app)/seo/_components/seo-table";
import { compareRows, type SearchRow } from "@/lib/seo-metrics";
import { searchKey, type SearchIntent, type SearchJudgment } from "@/lib/seo-intent-policy";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Development-only fixture for SEO → Palabras clave → "Solo compradores". The
 * filter talks to /api/seo/intent; here it answers from the table below, so the
 * control can be looked at without Google or a TypeSafe key. `?mode=no-key`
 * shows the install without one. /dev 404s in production.
 */

const SEARCHES: ReadonlyArray<[string, number, number, number, SearchIntent, number]> = [
  // query, clicks, impressions, position, what Jev reads, P(buyer)
  ["diseño de logo precio", 42, 610, 4.2, "buy", 0.94],
  ["como hacer un logo gratis", 88, 2400, 3.1, "learn", 0.06],
  ["agencia de branding bogotá", 31, 420, 6.8, "buy", 0.88],
  ["mejores estudios de diseño en colombia", 12, 380, 9.4, "compare", 0.57],
  ["estudio mock", 64, 140, 1.0, "navigate", 0.12],
  ["que es identidad de marca", 25, 1900, 7.7, "learn", 0.04],
  ["cotizar pagina web para negocio", 9, 150, 11.2, "buy", 0.91],
  ["paleta de colores para marca", 18, 1300, 12.5, "learn", 0.15],
];

const now: SearchRow[] = SEARCHES.map(([key, clicks, impressions, position]) => ({
  key, clicks, impressions, position, ctr: clicks / impressions,
}));
const before: SearchRow[] = now.map((row, i) => ({ ...row, clicks: Math.max(0, row.clicks + (i % 3) * 4 - 5) }));
const ROWS = compareRows(now, before);

const JUDGMENTS: Record<string, SearchJudgment> = Object.fromEntries(
  SEARCHES.map(([key, , , , intent, buyer]) => [
    searchKey(key),
    { buyer, intent, intentConfidence: 0.85, model: "jev-1.13", judgedAt: "2026-10-16T00:00:00Z", rubric: 1 },
  ]),
);

/** Stored judgments start empty: the first visit has nothing cached. */
const fixture = { judged: false };

function installFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/seo/intent")) return original(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as { cachedOnly?: boolean };
    const ready = new URLSearchParams(window.location.search).get("mode") !== "no-key";
    await new Promise((resolve) => setTimeout(resolve, body.cachedOnly ? 150 : 900));
    if (ready && !body.cachedOnly) fixture.judged = true;
    const judgments = ready && fixture.judged ? JUDGMENTS : {};
    return new Response(
      JSON.stringify({ ready, judgments, pending: SEARCHES.length - Object.keys(judgments).length }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

if (typeof window !== "undefined") installFetch();

export default function SeoBuyersPreview() {
  const { t, locale } = useI18n();
  const [buyersOnly, setBuyersOnly] = useState(false);
  const intents = useSearchIntents(ROWS, true);
  const rows = filterBuyers(ROWS, intents.judgments, buyersOnly);
  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="font-sans text-lg font-medium">SEO → Palabras clave → Solo compradores</h1>
          <p className="mt-2 text-muted-foreground text-sm">Fixture de desarrollo · datos de prueba</p>
          <nav className="mt-4 flex gap-4 text-xs">
            <a className="hover:underline" href="?">con key</a>
            <a className="hover:underline" href="?mode=no-key">no-key</a>
          </nav>
        </header>
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <div className="mb-4">
            <BuyerFilter buyersOnly={buyersOnly} intents={intents} onChange={setBuyersOnly} rows={ROWS} />
          </div>
          <SeoTable
            emptyLabel={t(intents.judging ? "seo.buyers.judgingEmpty" : "seo.buyers.empty")}
            kind="query"
            labels={searchLabels(ROWS, intents.judgments, t)}
            locale={locale}
            rows={rows}
            t={t}
          />
        </div>
      </div>
    </main>
  );
}
