"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { blendColor, BLUE_RAMP, cubicOut, flow, hash, hitStack, HoverTween, niceMax, quantity, smoothstep, stackRects, VectorTween, type StackRect } from "./geometry";
import { AnimatedNumber, ChartGrid, ChartPeriod } from "./primitives";
import { useTileCanvas } from "./use-tile-canvas";
import styles from "./tiles.module.css";

export type StackBand = { key: string; label: string; color?: string };
export type StackColumn = { key: string; label: string; values: readonly number[] };
type Hover = { column: number | null; band: number | null } | null;
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

export function StackedBars({ columns, bands, emptyLabel, totalLabel, formatValue }: {
  columns: readonly StackColumn[];
  bands: readonly StackBand[];
  emptyLabel: string;
  totalLabel: string;
  formatValue?: (value: number) => string;
}) {
  const { locale } = useI18n();
  const signature = columns.map((column) => `${column.key}:${column.values.join(",")}`).join("|");
  const [selection, setSelection] = useState<{ hover: Hover; signature: string } | null>(null);
  const hover = selection?.signature === signature ? selection.hover : null;
  const setHover = (next: Hover) => setSelection((old) => old?.signature === signature && old.hover?.column === next?.column && old.hover?.band === next?.band ? old : { hover: next, signature });
  const tweens = useRef(new Map<string, VectorTween>());
  const rects = useRef<StackRect[]>([]);
  const hoverTween = useRef(new HoverTween());
  const totals = columns.map((column) => column.values.reduce((sum, v) => sum + quantity(v), 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const max = niceMax(Math.max(...totals, 0));
  const scale = useRef(new VectorTween([max]));
  const format = formatValue ?? ((n: number) => Math.round(n).toLocaleString(locale));
  const activeColumn = hover?.column != null ? columns[hover.column] : undefined;
  const activeBand = hover?.band != null ? bands[hover.band] : undefined;
  const selectedValue = activeColumn ? activeBand ? activeColumn.values[hover!.band!] : totals[hover!.column!] : activeBand ? columns.reduce((sum, column) => sum + quantity(column.values[hover!.band!]), 0) : total;
  const { canvas, invalidate } = useTileCanvas(({ ctx, width, height, time, now, reduced }) => {
    scale.current.retarget([max], now, 620, cubicOut);
    const axisMax = Math.max(scale.current.read(now, reduced)[0], Number.EPSILON);
    for (const key of tweens.current.keys()) if (!columns.some((c) => c.key === key)) tweens.current.delete(key);
    const displayed = columns.map((column, i) => {
      let tween = tweens.current.get(column.key);
      if (!tween) { tween = new VectorTween(bands.map(() => 0)); tweens.current.set(column.key, tween); }
      tween.retarget(column.values.map(quantity), now + i * 31, 620, cubicOut);
      return tween.read(now, reduced);
    });
    rects.current = stackRects(displayed, width, height, axisMax);
    hoverTween.current.retain(columns.flatMap((column) => bands.map((band) => `${column.key}/${band.key}`)));
    for (const rect of rects.current) {
      if (!rect.height) continue;
      const { column, band, x, y, width: w, height: h } = rect;
      const active = hover?.band === band && (hover.column === null || hover.column === column);
      const otherColumn = hover?.column != null && hover.column !== column;
      const dim = otherColumn ? 0.3 : hover?.band != null && hover.band !== band ? 0.48 : 1;
      const [emphasis, opacity] = hoverTween.current.read(`${columns[column].key}/${bands[band].key}`, active ? 1 : 0, dim, now, reduced);
      const color = blendColor(bands[band]?.color ?? BLUE_RAMP[Math.min(band, 4)], "#2563EB", emphasis);
      const path = new Path2D();
      const visibleBands = displayed[column].map((v, i) => v > 0 ? i : -1).filter((i) => i >= 0);
      const bottom = band === visibleBands[0] ? 7 : 5;
      const top = band === visibleBands.at(-1) ? 8 : 5;
      path.roundRect(x, y, w, h, [top, top, bottom, bottom]);
      ctx.save();
      ctx.clip(path);
      const tiles = new Path2D();
      const cell = Math.max(3, Math.round(width / 200));
      for (let gx = x; gx < x + w; gx += cell) for (let gy = y; gy < y + h; gy += cell) {
        const fullness = smoothstep(1 - (gy - y) / h);
        const size = cell * (0.34 + 0.21 * emphasis + 0.3 * fullness + 0.24 * flow(gx, gy, time)) * (0.78 + 0.42 * hash(Math.round(gx / cell), Math.round((gy - y) / cell)));
        tiles.rect(gx + (cell - size) / 2, gy + (cell - size) / 2, size, size);
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.fill(tiles);
      ctx.restore();
      if (emphasis > 0.001) {
        ctx.save();
        ctx.strokeStyle = "#2563EB";
        ctx.shadowColor = "#2563EB8c";
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.75;
        ctx.globalAlpha = emphasis;
        ctx.stroke(path);
        ctx.restore();
      }
    }
  }, total > 0);

  return <div className={styles.root}>
    <div className={styles.stackSummary}>
      <AnimatedNumber className={styles.stackTotal} value={selectedValue ?? 0} format={format} />
      <span className={styles.stackCaption}><ChartPeriod value={`${hover?.column ?? "all"}-${hover?.band ?? "all"}`}>{activeColumn ? `${activeColumn.label}${activeBand ? ` · ${activeBand.label}` : ""}` : activeBand?.label ?? totalLabel}</ChartPeriod></span>
    </div>
    <div className={styles.stackLegend}>
      {bands.map((band, i) => <button type="button" key={band.key} style={{ opacity: activeBand && activeBand.key !== band.key ? 0.4 : 1 }} onPointerEnter={() => setHover({ column: null, band: i })} onPointerLeave={() => setHover(null)} onFocus={() => setHover({ column: null, band: i })} onBlur={() => setHover(null)}>
        <span className={styles.swatch} style={{ background: band.color ?? BLUE_RAMP[Math.min(i, 4)] }} />{band.label}
      </button>)}
    </div>
    <div className={styles.plotRow}>
      <div className={styles.axis} aria-hidden="true">{FRACTIONS.map((fraction) => <span key={fraction} style={{ bottom: `${fraction * 100}%` }}><AnimatedNumber value={max * fraction} format={formatValue ?? ((n) => new Intl.NumberFormat(locale, { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 0 }).format(n))} /></span>)}</div>
      <div className={styles.plot} style={{ height: 194 }}>
        <ChartGrid fractions={FRACTIONS} />
        <canvas aria-hidden="true" ref={canvas} className={styles.canvas} onPointerLeave={() => setHover(null)} onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHover(hitStack(rects.current, event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, columns.length));
          invalidate();
        }} />
        {!total && <div className={styles.empty} style={{ height: 194 }}>{emptyLabel}</div>}
      </div>
    </div>
    <div className={styles.columnLabels}>
      {columns.map((column, i) => <button type="button" key={column.key} className={styles.columnButton} data-active={hover?.column === i} title={column.label} onPointerEnter={() => setHover({ column: i, band: null })} onPointerLeave={() => setHover(null)} onFocus={() => setHover({ column: i, band: null })} onBlur={() => setHover(null)} onKeyDown={(event) => {
        if (event.key === "Escape") setHover(null);
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const band = ((hover?.band ?? (event.key === "ArrowUp" ? -1 : 0)) + (event.key === "ArrowUp" ? 1 : -1) + bands.length) % bands.length;
          setHover({ column: i, band });
        }
      }} aria-label={`${column.label}: ${format(totals[i])}`}>{column.label}</button>)}
    </div>
    <span className="sr-only" role="status">{hover ? `${activeColumn?.label ?? ""} ${activeBand?.label ?? ""}: ${format(selectedValue ?? 0)}` : ""}</span>
    <ul className="sr-only">{columns.map((column) => <li key={column.key}>{column.label}: {bands.map((band, i) => `${band.label} ${format(column.values[i] ?? 0)}`).join(", ")}</li>)}</ul>
  </div>;
}
