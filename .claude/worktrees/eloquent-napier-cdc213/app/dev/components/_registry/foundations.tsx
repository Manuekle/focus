"use client";

// The tokens every component below is made of. Read off `app/globals.css`
// by name rather than duplicated as values, so a token that changes there
// changes here on the next paint instead of on the next edit to this file.

import { ct } from "../_lib/catalog-i18n";
import { Swatch } from "../_lib/kit";
import type { Section } from "../_lib/types";

// ── Colour ──────────────────────────────────────────────────────────

const SURFACE_TOKENS = [
  { name: "--background", desc: "La página" },
  { name: "--foreground", desc: "Texto sobre la página" },
  { name: "--card", desc: "Superficie elevada" },
  { name: "--card-foreground", desc: "Texto sobre card" },
  { name: "--popover", desc: "Menús, tooltips, diálogos" },
  { name: "--muted", desc: "Campos, celdas, fondos secundarios" },
  { name: "--muted-foreground", desc: "Texto de apoyo" },
  { name: "--secondary", desc: "Superficie neutra suave" },
  { name: "--accent", desc: "Hover de item de lista" },
  { name: "--primary", desc: "La acción principal" },
  { name: "--primary-foreground", desc: "Texto sobre primary" },
  { name: "--destructive", desc: "Error y borrado" },
  { name: "--billing", desc: "El violeta de las pantallas de plan" },
  { name: "--border", desc: "Hairline entre superficies" },
  { name: "--input", desc: "Borde de campo" },
  { name: "--ring", desc: "Indicador de foco" },
] as const;

const STATUS_TOKENS = [
  "pending",
  "progress",
  "submitted",
  "review",
  "success",
  "failed",
  "expired",
] as const;

const SHADOW_TOKENS = [
  { name: "--shadow-soft", desc: "Card en reposo" },
  { name: "--shadow-elevated", desc: "Card en hover, popover" },
  { name: "--shadow-float", desc: "Diálogo, panel flotante" },
  { name: "--shadow-inset", desc: "Campo hundido" },
  { name: "--shadow-button", desc: "La receta de profundidad del botón" },
] as const;

const RADII = [
  { name: "--radius-sm", value: "calc(var(--radius) - 4px)" },
  { name: "--radius-md", value: "calc(var(--radius) - 2px)" },
  { name: "--radius-lg", value: "var(--radius) — 12px" },
  { name: "--radius-xl", value: "calc(var(--radius) + 4px)" },
] as const;

export function foundations(_locale?: string): Section {
  return {
    id: "foundations",
    title: ct("foundations.title"),
    desc: ct("foundations.desc"),
    entries: [
    {
      id: "tokens-color",
      name: ct("foundations.color.name"),
      source: "app/globals.css",
      importLine: 'className="bg-card text-muted-foreground border-border"',
      desc: ct("foundations.color.desc"),
      demos: [
        {
          id: "tokens-color-surfaces",
          title: ct("foundations.color.surfaces.title"),
          desc: ct("foundations.color.surfaces.desc"),
          code: 'var(--card)  /* en Tailwind: bg-card, text-card-foreground */',
          render: (
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
              {SURFACE_TOKENS.map((token) => (
                <Swatch key={token.name} name={token.name} value={token.desc}>
                  <div
                    className="h-12 w-full rounded-lg border border-border"
                    style={{ background: `var(${token.name})` }}
                  />
                </Swatch>
              ))}
            </div>
          ),
        },
        {
          id: "tokens-color-status",
          title: ct("foundations.color.status.title"),
          desc: ct("foundations.color.status.desc"),
          code: 'style={{ background: "var(--status-success-bg)", color: "var(--status-success-fg)" }}',
          render: (
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
              {STATUS_TOKENS.map((token) => (
                <Swatch key={token} name={`--status-${token}-bg`} value={`--status-${token}-fg`}>
                  <div
                    className="grid h-12 w-full place-items-center rounded-lg text-[11px] font-medium"
                    style={{
                      background: `var(--status-${token}-bg)`,
                      color: `var(--status-${token}-fg)`,
                    }}
                  >
                    {token}
                  </div>
                </Swatch>
              ))}
            </div>
          ),
        },
      ],
    },
    {
      id: "tokens-elevation",
      name: ct("foundations.elevation.name"),
      source: "app/globals.css",
      importLine: 'className="rounded-xl shadow-[var(--shadow-soft)]"',
      desc: ct("foundations.elevation.desc"),
      demos: [
        {
          id: "tokens-shadows",
          title: ct("foundations.elevation.shadows.title"),
          code: 'className="shadow-[var(--shadow-elevated)]"',
          surface: "page",
          render: (
            <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-5">
              {SHADOW_TOKENS.map((token) => (
                <Swatch key={token.name} name={token.name} value={token.desc}>
                  <div
                    className="h-14 w-full rounded-xl border border-border bg-card"
                    style={{ boxShadow: `var(${token.name})` }}
                  />
                </Swatch>
              ))}
            </div>
          ),
        },
        {
          id: "tokens-radius",
          title: ct("foundations.elevation.radius.title"),
          code: 'className="rounded-lg"  /* = var(--radius-lg) */',
          render: (
            <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4">
              {RADII.map((radius) => (
                <Swatch key={radius.name} name={radius.name} value={radius.value}>
                  <div
                    className="h-14 w-full border border-border bg-muted"
                    style={{ borderRadius: `var(${radius.name})` }}
                  />
                </Swatch>
              ))}
            </div>
          ),
        },
      ],
    },
    {
      id: "tokens-type",
      name: ct("foundations.typography.name"),
      source: "app/globals.css",
      importLine: 'className="font-heading | font-sans | font-mono"',
      desc: ct("foundations.typography.desc"),
      demos: [
        {
          id: "type-families",
          title: ct("foundations.typography.families.title"),
          code: '<h2 className="font-heading text-2xl">…</h2>',
          render: (
            <div className="flex w-full flex-col gap-4">
              <div>
                <p className="mb-1 font-mono text-[11px] text-muted-foreground">font-heading — Apple UI / Inter</p>
                <p className="font-heading text-2xl tracking-[-0.02em]">Agentes que contestan solos</p>
              </div>
              <div>
                <p className="mb-1 font-mono text-[11px] text-muted-foreground">font-sans — Inter</p>
                <p className="text-sm">
                  El cuerpo de la app. Tabular para cifras: <span className="tabular-nums">1.284 · 99,4 %</span>
                </p>
              </div>
              <div>
                <p className="mb-1 font-mono text-[11px] text-muted-foreground">font-mono — Geist Mono</p>
                <p className="font-mono text-xs">const agent = await createAgent(config);</p>
              </div>
            </div>
          ),
        },
        {
          id: "type-scale",
          title: ct("foundations.typography.scale.title"),
          code: 'text-xs · text-sm · text-base · text-lg · text-2xl',
          render: (
            <div className="flex w-full flex-col gap-2">
              {(["text-xs", "text-sm", "text-base", "text-lg", "text-2xl"] as const).map((size) => (
                <div key={size} className="flex items-baseline gap-4">
                  <code className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">{size}</code>
                  <p className={size}>Cada canal en una sola bandeja</p>
                </div>
              ))}
            </div>
          ),
        },
      ],
    },
  ],
  };
}
