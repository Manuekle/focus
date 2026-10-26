"use client";

// The tokens every component below is made of. Read off `styles/tokens.css + styles/recipes.css`
// by name rather than duplicated as values, so a token that changes there
// changes here on the next paint instead of on the next edit to this file.

import { HugeiconsIcon } from "../../components/icons/icon";
import { Add01Icon, Search01Icon, Settings01Icon, CheckmarkCircle02Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
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
      source: "styles/tokens.css + styles/recipes.css",
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
      source: "styles/tokens.css + styles/recipes.css",
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
      source: "styles/tokens.css + styles/recipes.css",
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
                <p className="mb-1 font-mono text-[11px] text-muted-foreground">font-heading — Inter</p>
                <p className="font-heading text-2xl tracking-[-0.02em]">Espacio para la siguiente idea</p>
              </div>
              <div>
                <p className="mb-1 font-mono text-[11px] text-muted-foreground">font-sans — Inter</p>
                <p className="text-sm">
                  El cuerpo de la app. Tabular para cifras: <span className="tabular-nums">1.284 · 99,4 %</span>
                </p>
              </div>
              <div>
                <p className="mb-1 font-mono text-[11px] text-muted-foreground">font-mono — Inter</p>
                <p className="font-mono text-xs">{'import { Button } from "@focus/ui/ui/button";'}</p>
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
                  <p className={size}>Un espacio para avanzar</p>
                </div>
              ))}
            </div>
          ),
        },
      ],
    },

    {
      id: "tokens-spacing", name: _locale === "en" ? "Spacing & layout" : "Espaciado y layout",
      source: "styles/focus-theme.css", importLine: 'className="gap-4 p-6 max-w-5xl"',
      desc: "Escala de 4 px con medios pasos para el detalle. La distancia agrupa controles y separa secciones.",
      demos: [{id:"spacing-scale", title:"Escala de espaciado", code:'gap-1 /* 4 px */ · gap-2 /* 8 px */ · gap-4 /* 16 px */ · p-6 /* 24 px */', render:(
        <div className="flex w-full max-w-md flex-col gap-3">{[4,8,12,16,20,24,32,40,48,64].map(value=><div key={value} className="flex items-center gap-5"><code className="w-12 shrink-0 text-xs text-muted-foreground">{value}px</code><div className="h-4 rounded-sm bg-primary/70" style={{width:value*3}}/></div>)}</div>
      )}]
    },
    {
      id:"tokens-icons", name:_locale === "en" ? "Iconography" : "Iconografía", source:"components/icons/icon.tsx",
      importLine:'import { HugeiconsIcon } from "@focus/ui/icons";',
      desc:"Hugeicons en toda la interfaz: línea coherente, currentColor y SVG decorativo por defecto. La marca Focus tiene su propio componente.",
      notes:["Importa los datos del icono desde @hugeicons/core-free-icons.","Un botón sin texto necesita aria-label. No uses el nombre del icono como nombre de la acción."],
      demos:[{id:"icon-set",title:"Tamaños y uso",code:'<Button aria-label="Buscar" size="icon"><HugeiconsIcon icon={Search01Icon} size={16} /></Button>',render:(
        <div className="flex flex-wrap gap-6">{[Add01Icon,Search01Icon,Settings01Icon,CheckmarkCircle02Icon,ArrowRight01Icon].map((icon,index)=><div key={index} className="flex items-center gap-4 rounded-xl border border-border p-4 text-muted-foreground"><HugeiconsIcon icon={icon} size={16}/><HugeiconsIcon icon={icon} size={24}/></div>)}</div>
      )}]
    },
    {
      id:"tokens-layers",name:_locale === "en" ? "Layers & motion" : "Capas y movimiento",source:"styles/recipes.css",
      importLine:'className="t-modal" /* Dialog ya aplica esta receta */',
      desc:"Las superficies abren y cierran con intención. Los componentes aplican sus recetas y conservan la variante de movimiento reducido.",
      notes:["No añadas transiciones globales entre rutas ni animación a cada pulsación.","Las capas globales son base 0, sticky 30, overlay 50 y toast 100. Los portales controlan sus propios contextos."],
      demos:[{id:"motion-scale",title:"Duraciones por función",code:'var(--modal-open-dur) /* 250ms */ · var(--modal-close-dur) /* 150ms */',render:(
        <div className="grid w-full gap-3 sm:grid-cols-2">{[["Modal","250 / 150 ms"],["Panel","400 / 350 ms"],["Tooltip","150 / 90 ms"],["Selección de pestaña","250 ms reversible"]].map(([name,value])=><div key={name} className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3"><span className="text-xs">{name}</span><code className="text-[10px] text-muted-foreground">{value}</code></div>)}</div>
      )}]
    },
  ],
  };
}
