"use client";

import { CreativesPanel } from "@/app/(app)/ads/_components/creatives-panel";
import { overallGrade, type AdGrade, type ScoreDimension } from "@/lib/ad-grader-policy";

/**
 * Development-only fixture for the Ads → Creativos tab. The panel talks to
 * /api/ads/creatives and /api/ads/review; here both answer from the data
 * below, so the tab can be looked at without a Meta account or a TypeSafe key.
 * Synthetic values never reach a real install: /dev 404s in production.
 */

function grade(format: AdGrade["format"], funnel: AdGrade["funnel"], s: Record<ScoreDimension, number>, sawImage = true): AdGrade {
  return {
    rubric: 1,
    gradedAt: "2026-10-16T12:00:00.000Z",
    model: "jev-1.13",
    sawImage,
    format,
    formatConfidence: 0.88,
    funnel,
    funnelConfidence: 0.74,
    scores: s,
    overall: overallGrade(s),
  };
}

const ROWS = [
  {
    adId: "a1",
    name: "Reto: 300 escalones con el maquillaje puesto",
    status: "ACTIVE",
    copy: { primaryText: "¿Aguanta el labial 300 escalones? Lo probamos con Vale subiendo Monserrate. Spoiler: llegó intacto.", headline: "Prueba real, sin filtros", cta: "SHOP_NOW", kind: "video" as const },
    spend: 182.4, impressions: 41_200, clicks: 1_310, results: 64,
    grade: grade("ugc", "consideration", { hook: 3.8, cta: 2.9, offer: 2.1, proof: 3.6, audience: 2.7, boldness: 3.9, claimRisk: 0.6 }),
  },
  {
    adId: "a2",
    name: "Catálogo labiales otoño",
    status: "ACTIVE",
    copy: { primaryText: "Nueva colección de labiales. Varios tonos disponibles.", headline: "Colección otoño", cta: "SHOP_NOW", kind: "carousel" as const },
    spend: 240.1, impressions: 52_900, clicks: 610, results: 18,
    grade: grade("catalog", "conversion", { hook: 1.1, cta: 2.2, offer: 1.4, proof: 0.6, audience: 0.9, boldness: 0.7, claimRisk: 0.3 }),
  },
  {
    adId: "a3",
    name: "Base que borra imperfecciones en 1 día",
    status: "PAUSED",
    copy: { primaryText: "¿Tenés manchas en la cara? Nuestra base las elimina para siempre en 24 horas. Resultados garantizados.", headline: "Piel perfecta garantizada", cta: "LEARN_MORE", kind: "image" as const },
    spend: 61.7, impressions: 9_800, clicks: 240, results: 9,
    grade: grade("before_after", "conversion", { hook: 2.8, cta: 1.6, offer: 2.4, proof: 1.2, audience: 2.9, boldness: 2.1, claimRisk: 3.4 }),
  },
  {
    adId: "a4",
    name: "Cómo elegir tu tono en 3 pasos",
    status: "ACTIVE",
    copy: { primaryText: "Tres pasos para elegir tu tono sin probarte nada. Guardalo para tu próxima compra.", headline: "Guía rápida", cta: "WHATSAPP_MESSAGE", kind: "image" as const },
    spend: 38.2, impressions: 6_400, clicks: 150, results: 5,
    grade: grade("educational", "awareness", { hook: 2.4, cta: 2.6, offer: 1.0, proof: 1.8, audience: 2.2, boldness: 1.6, claimRisk: 0.2 }, false),
  },
  {
    adId: "a5",
    name: "Boosted post 12/10",
    status: "ACTIVE",
    copy: { primaryText: "", headline: "", cta: "", kind: "image" as const },
    spend: 12, impressions: 2_100, clicks: 30, results: 0,
    grade: null,
  },
].map((row) => ({
  ...row,
  thumbnailUrl: null,
  campaignId: "c1",
  creativeId: row.adId,
  // A boosted post Meta shares no words or picture for: nothing to grade.
  ungradable: !row.copy.primaryText && !row.copy.headline,
}));

function report(graded: boolean, ready: boolean) {
  const rows = ROWS.map((row) => ({ ...row, grade: graded && ready ? row.grade : null }));
  const gradedRows = rows.filter((row) => row.grade);
  return {
    graderReady: ready,
    rows,
    pending: rows.filter((row) => !row.grade && !row.ungradable).length,
    gradedNow: 0,
    summary: graded && ready
      ? {
          graded: gradedRows.length,
          // Computed, not typed in: the competitors card averages the same
          // grades, and the two lines must agree on screen.
          averageGrade: Math.round((gradedRows.reduce((sum, row) => sum + (row.grade?.overall ?? 0), 0) / gradedRows.length) * 100) / 100,
          formats: [
            { format: "catalog", ads: 1, spend: 240.1, impressions: 52_900, clicks: 610, results: 18, ctr: 0.0115, costPerResult: 13.34, averageGrade: 1.2 },
            { format: "ugc", ads: 1, spend: 182.4, impressions: 41_200, clicks: 1_310, results: 64, ctr: 0.0318, costPerResult: 2.85, averageGrade: 3.4 },
            { format: "before_after", ads: 1, spend: 61.7, impressions: 9_800, clicks: 240, results: 9, ctr: 0.0245, costPerResult: 6.86, averageGrade: 2.3 },
            { format: "educational", ads: 1, spend: 38.2, impressions: 6_400, clicks: 150, results: 5, ctr: 0.0234, costPerResult: 7.64, averageGrade: 2.0 },
          ],
          bestFormat: "ugc",
          bestFormatBy: "costPerResult",
          topAdId: "a1",
          riskyAdIds: ["a3"],
        }
      : { graded: 0, averageGrade: null, formats: [], bestFormat: null, bestFormatBy: null, topAdId: null, riskyAdIds: [] },
  };
}

/** Two competitors' ads as an Ad Library import would leave them. */
const RIVALS = [
  {
    id: "lib-1", competitor: "Glam Lab", source: "ad_library",
    copy: { primaryText: "Le pedimos a 5 clientas que lo usaran 12 horas seguidas. Esto pasó.", headline: "La prueba de las 12 horas", kind: "video" },
    daysActive: 64, isActive: true,
    grade: grade("ugc", "consideration", { hook: 3.7, cta: 2.6, offer: 2.2, proof: 3.8, audience: 2.9, boldness: 3.6, claimRisk: 0.7 }),
  },
  {
    id: "lib-2", competitor: "Glam Lab", source: "ad_library",
    copy: { primaryText: "Labial mate 24 h. 2x1 solo este fin de semana.", headline: "2x1 en labiales", kind: "image" },
    daysActive: 9, isActive: true,
    grade: grade("offer", "conversion", { hook: 2.4, cta: 3.4, offer: 3.6, proof: 1.1, audience: 1.8, boldness: 1.5, claimRisk: 0.9 }),
  },
  {
    id: "lib-3", competitor: "Bella Store", source: "ad_library",
    copy: { primaryText: "Maquilladora profesional prueba nuestra base bajo la lluvia.", headline: "¿Resiste la lluvia?", kind: "video" },
    daysActive: 31, isActive: true,
    grade: grade("demo", "consideration", { hook: 3.4, cta: 2.3, offer: 1.9, proof: 3.5, audience: 2.6, boldness: 3.2, claimRisk: 0.4 }),
  },
];

type Mode = "graded" | "fresh" | "no-key";
const MODES: readonly Mode[] = ["graded", "fresh", "no-key"];

/** Which state the fixture is in: `?mode=` on the URL, so each one is a link. */
function modeFromUrl(): Mode {
  const raw = new URLSearchParams(window.location.search).get("mode");
  return MODES.includes(raw as Mode) ? (raw as Mode) : "graded";
}

/** Set once "Analizar" has been pressed on the `fresh` fixture. */
const fixture = { analyzed: false };

/**
 * Answers the panel's two routes from the fixture. Installed when the module
 * loads, before the panel's first effect asks for its report.
 */
function installFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/ads/creatives")) {
      await new Promise((resolve) => setTimeout(resolve, init?.method === "POST" ? 1_200 : 300));
      if (init?.method === "POST") fixture.analyzed = true;
      const mode = modeFromUrl();
      return json(report(mode === "graded" || fixture.analyzed, mode !== "no-key"));
    }
    if (url.includes("/api/ads/competitors")) {
      await new Promise((resolve) => setTimeout(resolve, init?.method === "POST" ? 1_200 : 200));
      const mode = modeFromUrl();
      return json({ importReady: mode === "graded", graderReady: mode !== "no-key", ads: mode === "graded" ? RIVALS : [] });
    }
    if (url.includes("/api/ads/review")) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return json({ grade: ROWS[2].grade });
    }
    return original(input, init);
  };
}

if (typeof window !== "undefined") installFetch();

export default function CreativesPreview() {
  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="font-sans text-lg font-medium">Anuncios → Creativos</h1>
          <p className="mt-2 text-muted-foreground text-sm">Fixture de desarrollo · datos de prueba</p>
          <nav className="mt-4 flex flex-wrap gap-4 text-xs underline-offset-4">
            {MODES.map((option) => (
              <a className="hover:underline" href={`?mode=${option}`} key={option}>
                {option}
              </a>
            ))}
          </nav>
        </header>
        <CreativesPanel datePreset="last_30d" />
      </div>
    </main>
  );
}
