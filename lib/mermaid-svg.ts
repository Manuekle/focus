import { renderMermaidSVGAsync, type DiagramColors } from "beautiful-mermaid";

/**
 * One Mermaid renderer, three callers.
 *
 * `beautiful-mermaid` turns Mermaid text into an SVG string with a text parser
 * and its own layout pass — no DOM, no measuring, so the same call works in a
 * client component and in a route handler. That is what lets the diagram in a
 * chat reply, the chart in a report card and the chart in the downloaded PDF
 * all come out of the same function instead of three drawing engines that
 * drift.
 *
 * What lives here is everything that has to happen to its output before it is
 * usable, and every caller needs all of it:
 *
 *   - the Google Fonts `@import` it hardcodes, removed
 *   - `xychart` series colours pointed back at the theme
 *   - one Mermaid construct it mis-parses, rewritten
 *   - optionally, the root `<svg>` made responsive
 *
 * Callers: `components/ai-elements/mermaid-plugin.ts` (```mermaid fences in a
 * reply), `app/_components/chat/artifacts/report-chart.tsx` (a `ChartSpec` in
 * a report) and `lib/report-pdf.ts` (the same chart, on paper).
 */

/**
 * Every colour role the renderer accepts, all seven filled in, as CSS
 * variables so a diagram rendered once repaints when the user flips the theme
 * instead of staying light-mode grey on a dark card.
 *
 * The values behind them are the zinc ramp (`app/globals.css`), not the app's
 * own surface tokens. A diagram is a drawing, not a panel: it wants its own
 * flat, neutral palette rather than `--card` on `--card` with `--border`
 * between them, which is what an unstyled diagram inherited before and which
 * came out as a grey box on a grey box.
 *
 * All seven are passed on purpose. Anything left out is derived with
 * `color-mix()`, and Lightning CSS mangles `color-mix(… , transparent)` in
 * this project — it ships at full alpha — so a derived `--muted` would come
 * out as solid foreground.
 */
export const THEME_COLORS: DiagramColors = {
  accent: "var(--diagram-accent)",
  bg: "var(--diagram-bg)",
  border: "var(--diagram-border)",
  fg: "var(--diagram-fg)",
  line: "var(--diagram-line)",
  muted: "var(--diagram-muted)",
  surface: "var(--diagram-surface)",
};

/**
 * The same palette as literal hex, for the PDF.
 *
 * Paper has no theme to follow and no engine to resolve a `var()`, so the
 * export needs the light values baked in. Kept beside the variables rather
 * than read out of the stylesheet: a route handler has no computed styles, and
 * a second copy that is wrong is louder than one that is merely duplicated —
 * `tests/report-pdf.test.ts` asserts these stay hex.
 */
export const PRINT_COLORS: DiagramColors = {
  accent: "#3f3f46",
  bg: "#ffffff",
  border: "#d4d4d8",
  fg: "#18181b",
  line: "#a1a1aa",
  muted: "#71717a",
  surface: "#fafafa",
};

/** The light-theme `--diagram-series-*` ramp, for the same reason. */
export const PRINT_SERIES: readonly string[] = [
  "#3b82f6",
  "#4338ca",
  "#0ea5e9",
  "#1e3a8a",
  "#6366f1",
  "#0369a1",
  "#60a5fa",
  "#a5b4fc",
];

/**
 * The renderer hardcodes an `@import` of Inter from Google Fonts into every
 * SVG it emits, and its `font` option only changes which family it asks
 * Google for — there is no way to turn it off.
 *
 * The import buys nothing: what it costs is a third-party request from inside
 * the business owner's console, once per diagram. Cut it out.
 */
const GOOGLE_FONTS_IMPORT = /@import\s+url\((['"]?)https:\/\/fonts\.googleapis\.com[^)]*\1\);?/g;

/**
 * The family the renderer declares for every label: `'Inter', system-ui, …`.
 * Pinned to Inter, a diagram downloads Inter on Apple devices, where the rest
 * of the interface is SF Pro. The labels follow the platform face
 * instead (`--font-sans`, set in `app/globals.css`); an SVG shown outside the
 * app's stylesheet falls back to the device's own UI face.
 */
const RENDERER_FONT_FAMILY = /font-family:\s*'Inter',/g;
const PLATFORM_FONT_FAMILY = "font-family: var(--font-sans, system-ui),";

/**
 * `xychart` series colours, handed back to the theme.
 *
 * The renderer picks them itself: series 0 becomes `--accent` and 1..n become
 * hex shades it derives from that accent at render time. With a zinc accent
 * that is a chart drawn in five greys, and a hex baked at render time is a
 * chart that stops matching the moment the theme flips.
 *
 * So both problems go away by pointing each `--xychart-color-N` at a
 * `--diagram-series-N` variable instead. The shade the renderer computed stays
 * on as the fallback, which is what indices past the eight we define get.
 */
const XYCHART_COLOR_VAR = /--xychart-color-(\d+):\s*([^;]+);/g;

/**
 * `}o` on the left of an ER relationship — zero-or-more, the crow's foot with
 * the circle — is valid Mermaid that `beautiful-mermaid` does not parse: it
 * sorts the two characters and matches `o{`, `{o` and `|}` but never `o}`.
 * A relationship line it cannot parse is dropped silently, so
 * `EMPLOYEE }o..o{ PROJECT : works_on` renders as an empty diagram rather than
 * throwing into the mermaid.js fallback.
 *
 * `o{` means the same thing on the same side, so rewriting it loses nothing.
 */
const ER_ZERO_MANY_LEFT = /\}o(--|\.\.)/g;

/**
 * The renderer sizes the root `<svg>` in absolute pixels — a twelve-node
 * left-to-right flowchart comes out 1763px wide — and a chat column is nowhere
 * near that. Dropped into a centred, `overflow: hidden` box, what the reader
 * gets is the middle four hundred pixels of the diagram, which on a wide
 * flowchart is usually the gap between two nodes: a card that looks empty.
 *
 * Adding the responsive-image pair to the `style` attribute fixes it without
 * touching the geometry. `width`/`height` stay as presentation attributes, so a
 * small diagram still renders at its natural size, and `style` outranks them,
 * so a wide one caps at the container and scales its height to match.
 */
const SVG_OPEN_TAG = /^(\s*)<svg\b([^>]*)>/;
const RESPONSIVE = "max-width:100%;height:auto;";

export type RenderDiagramOptions = {
  /** Overrides `THEME_COLORS` — the PDF passes `PRINT_COLORS`. */
  readonly colors?: DiagramColors;
  /**
   * `xychart` hover tooltips. On screen this is where the exact value of a bar
   * lives; on paper there is nobody to hover, and the extra hit-area groups
   * are elements `report-pdf-chart.ts` would have to skip.
   */
  readonly interactive?: boolean;
  /** Canvas padding in px. */
  readonly padding?: number;
  /**
   * Cap the root `<svg>` at its container. On by default; the PDF turns it off
   * because it reads the geometry rather than laying the SVG out.
   */
  readonly responsive?: boolean;
  /** Baked series colours, for callers with no stylesheet behind them. */
  readonly series?: readonly string[];
};

export async function renderDiagramSvg(
  source: string,
  options: RenderDiagramOptions = {},
): Promise<string> {
  const svg = await renderMermaidSVGAsync(normalizeErCardinality(source), {
    ...(options.colors ?? THEME_COLORS),
    // Whatever the diagram sits in already paints a background; a second
    // opaque rect inside it just makes a lighter box on a lighter box.
    transparent: true,
    interactive: options.interactive ?? false,
    padding: options.padding ?? 16,
  });

  const themed = applySeriesColors(
    svg.replace(GOOGLE_FONTS_IMPORT, "").replace(RENDERER_FONT_FAMILY, PLATFORM_FONT_FAMILY),
    options.series,
  );
  return options.responsive === false ? themed : fitToContainer(themed);
}

export function normalizeErCardinality(source: string): string {
  return /^\s*erDiagram\b/.test(source) ? source.replace(ER_ZERO_MANY_LEFT, "o{$1") : source;
}

function applySeriesColors(svg: string, series: readonly string[] | undefined): string {
  return svg.replace(XYCHART_COLOR_VAR, (_match, index: string, generated: string) => {
    const baked = series?.[Number(index)];
    const value = baked ?? `var(--diagram-series-${index}, ${generated})`;
    return `--xychart-color-${index}: ${value};`;
  });
}

export function fitToContainer(svg: string): string {
  return svg.replace(SVG_OPEN_TAG, (_match, lead: string, attrs: string) => {
    const sized = /\sstyle="/.test(attrs)
      ? attrs.replace(/\sstyle="/, ` style="${RESPONSIVE}`)
      : `${attrs} style="${RESPONSIVE}"`;
    return `${lead}<svg${sized}>`;
  });
}

// ── xychart legend ──────────────────────────────────────────────────

/**
 * The real series names, in place of "Bar 1" and "Line 2".
 *
 * `xychart-beta` has no syntax for naming a series, so the renderer numbers
 * them by type and lays the legend out from the width of *those* strings,
 * centred on the canvas. Dropping longer names into the same slots would run
 * one item into the next, so the row is rebuilt rather than patched: the
 * swatches and their classes are the renderer's own — colours stay
 * theme-driven — and only the labels and the x positions are ours.
 *
 * A single-series chart has no legend to relabel; the renderer only draws one
 * past two series.
 */
const LEGEND_ITEM =
  /<(rect|line)\b([^>]*?)class="(xychart-bar|xychart-legend-line) (xychart-color-\d+)"([^>]*)\/>\s*<text\b([^>]*?)>(?:Bar|Line) \d+<\/text>/g;

/** `XY` in beautiful-mermaid's xychart layout. Mirrored, because none of it is exported. */
const LEGEND = { fontSize: 14, gap: 6, itemGap: 16, swatch: 14 } as const;

export function relabelLegend(svg: string, names: readonly string[]): string {
  const items = [...svg.matchAll(LEGEND_ITEM)];
  if (items.length === 0) return svg;

  const canvasWidth = Number(svg.match(/viewBox="0 0 ([\d.]+)/)?.[1] ?? 0);
  if (!canvasWidth) return svg;

  const labels = items.map((item, index) => names[index] ?? `${index + 1}`);
  const widths = labels.map(
    (label) => LEGEND.swatch + LEGEND.gap + estimateWidth(label, LEGEND.fontSize),
  );
  const total = widths.reduce((sum, width) => sum + width, 0) + (items.length - 1) * LEGEND.itemGap;

  let x = canvasWidth / 2 - total / 2;
  const rewritten = new Map<string, string>();
  items.forEach((item, index) => {
    const [match, tag, before, , colorClass, after, textAttrs] = item as unknown as string[];
    const swatchEnd = x + LEGEND.swatch;
    const mark =
      tag === "rect"
        ? `<rect${moveRect(before ?? "", after ?? "", x)}class="xychart-bar ${colorClass}"/>`
        : `<line${moveLine(before ?? "", after ?? "", x, swatchEnd)}class="xychart-legend-line ${colorClass}"/>`;
    const text = `<text${setX(textAttrs ?? "", swatchEnd + LEGEND.gap)}>${escapeText(labels[index]!)}</text>`;
    rewritten.set(match!, `${mark}${text}`);
    x += (widths[index] ?? 0) + LEGEND.itemGap;
  });

  let out = svg;
  for (const [from, to] of rewritten) out = out.replace(from, to);
  return out;
}

function moveRect(before: string, after: string, x: number): string {
  return ` ${setAttr(`${before}${after}`.trim(), "x", x)} `;
}

function moveLine(before: string, after: string, x1: number, x2: number): string {
  return ` ${setAttr(setAttr(`${before}${after}`.trim(), "x1", x1), "x2", x2)} `;
}

function setX(attrs: string, x: number): string {
  return ` ${setAttr(attrs.trim(), "x", x)}`;
}

function setAttr(attrs: string, name: string, value: number): string {
  const pattern = new RegExp(`\\b${name}="[^"]*"`);
  const next = `${name}="${Math.round(value * 100) / 100}"`;
  return pattern.test(attrs) ? attrs.replace(pattern, next) : `${next} ${attrs}`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Roughly how wide a string is in Inter, in px.
 *
 * Only ever used to centre the legend row, so being a few percent out shifts
 * the whole row by a pixel or two and nothing overlaps. The alternative is
 * `measureTextWidth` from inside `beautiful-mermaid`, which the package does
 * not export.
 */
function estimateWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) {
    if (/[iIl|!.,:;'`\[\]()]/.test(char)) em += 0.31;
    else if (/[mMWw@]/.test(char)) em += 0.88;
    else if (/[A-Z0-9]/.test(char)) em += 0.63;
    else if (char === " ") em += 0.27;
    else em += 0.53;
  }
  return em * fontSize;
}
