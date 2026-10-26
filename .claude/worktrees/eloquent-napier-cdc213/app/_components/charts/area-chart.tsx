"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as motion from "motion/react-m";
import { useSpring, useTransform } from "motion/react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { clamp, hash, mix, quantity, sampleCurve, smoothstep, VectorTween } from "./geometry";
import { AnimatedNumber, ChartGrid, MARKER_SPRING } from "./primitives";
import { useTileCanvas } from "./use-tile-canvas";
import { toneColor, type ChartTone, type TimePoint } from "./types";
import styles from "./tiles.module.css";

const FRACTIONS = [1, 0.66, 0.33, 0];
const SAMPLES = 181;

export function TimeSeries({ data, emptyLabel, formatValue, formatAxis, height = 194, markers, tone = "neutral" }: {
  readonly data: readonly TimePoint[];
  readonly emptyLabel: string;
  readonly formatValue: (point: TimePoint) => ReactNode;
  readonly formatAxis?: (value: number) => string;
  readonly height?: number;
  readonly markers?: ReadonlySet<string>;
  readonly tone?: ChartTone;
}) {
  const { locale } = useI18n();
  const signature = data.map((point) => `${point.key}:${point.value}`).join("|");
  const [selection, setSelection] = useState<{ key: string | null; signature: string } | null>(null);
  const active = selection?.signature === signature ? data.findIndex((point) => point.key === selection.key) : -1;
  const setActiveKey = (key: string | null) => setSelection((old) => old?.key === key && old.signature === signature ? old : { key, signature });
  const point = data[active];
  const plot = useRef<HTMLDivElement>(null);
  const pointer = useRef({ rawX: -1000, rawY: -1000, x: -1000, y: -1000 });
  const glows = useRef(new Map<string, number>());
  const max = Math.max(...data.map((p) => quantity(p.value)), 0) / 0.84 || 1;
  const target = useMemo(() => [...Array.from({ length: SAMPLES }, (_, i) => sampleCurve(data.map((p) => p.value), i / (SAMPLES - 1))), max], [data, max]);
  const tween = useRef(new VectorTween(target));
  const x = useSpring(0, MARKER_SPRING);
  const y = useSpring(0, MARKER_SPRING);
  const markerLeft = useTransform(x, [0, 1], ["0%", "100%"]);
  const markerTop = useTransform(y, [0, 1], ["0%", "100%"]);
  const tooltipLeft = useTransform(() => `clamp(0px, calc(${x.get() * 100}% - 85px), max(0px, calc(100% - 170px)))`);
  const { canvas, reduced } = useTileCanvas(({ ctx, width, height: h, now, time, reduced }) => {
    tween.current.retarget(target, now, 460);
    const current = tween.current.read(now, reduced);
    const scale = Math.max(current[SAMPLES], Number.EPSILON);
    const curve = current.slice(0, SAMPLES);
    const cell = Math.max(3, Math.round(width / 180));
    const p = pointer.current;
    const speed = Math.hypot(p.rawX - p.x, p.rawY - p.y);
    p.x = mix(p.x, p.rawX, 0.45);
    p.y = mix(p.y, p.rawY, 0.45);
    const radius = h * (0.24 + 0.26 * clamp(speed / 50));
    const rest = new Path2D();
    const blue = new Path2D();
    for (let gx = 0; gx < width; gx += cell) {
      const ceiling = h * (1 - sampleCurve(curve, gx / width) / scale);
      for (let gy = Math.ceil(ceiling / cell) * cell; gy < h; gy += cell) {
        if (ceiling >= h || gy + cell * 0.15 < ceiling) continue;
        const jitter = hash(gx, gy);
        const edge = 1 - clamp((gy - ceiling) / Math.max(h - ceiling, 1));
        const distance = Math.hypot(gx - p.x, gy - p.y);
        const light = reduced ? 0 : smoothstep(1 - distance / radius);
        const key = `${gx},${gy}`;
        const previous = glows.current.get(key) ?? 0;
        const glow = reduced ? 0 : mix(previous, light, light > previous ? 0.22 : 0.05);
        if (!reduced) glows.current.set(key, glow);
        const shimmer = reduced ? 1 : 1 + Math.sin(gy * 0.025 - time * 0.6) * 0.07;
        const restSize = cell * 0.24;
        rest.rect(gx + (cell - restSize) / 2, gy + (cell - restSize) / 2, restSize, restSize);
        const size = cell * clamp((0.12 + 0.55 * smoothstep(edge) + glow * 0.28) * shimmer, 0, 0.9);
        const spark = !reduced && jitter > 0.94 ? Math.sin(time * 2 + jitter * 100) * glow * cell * 0.12 : 0;
        blue.rect(gx + (cell - size) / 2 + spark, gy + (cell - size) / 2 - spark, size, size);
      }
    }
    if (glows.current.size > 40000) glows.current.clear();
    ctx.fillStyle = "oklch(0.9 0.02 264)";
    ctx.fill(rest);
    ctx.fillStyle = toneColor(tone);
    ctx.globalAlpha = 0.8;
    ctx.fill(blue);
    if (active >= 0) {
      const fraction = data.length <= 1 ? 0.5 : active / (data.length - 1);
      const top = clamp(1 - sampleCurve(curve, fraction) / scale);
      if (reduced) { x.jump(fraction); y.jump(top); }
      else { x.set(fraction); y.set(top); }
    }
  }, data.some((p) => p.value > 0));

  useEffect(() => {
    if (reduced) return;
    const follow = (event: PointerEvent) => {
      const rect = plot.current?.getBoundingClientRect();
      if (!rect) return;
      pointer.current.rawX = event.clientX - rect.left;
      pointer.current.rawY = event.clientY - rect.top;
    };
    window.addEventListener("pointermove", follow, { passive: true });
    return () => window.removeEventListener("pointermove", follow);
  }, [reduced]);

  const ticks = Array.from({ length: Math.min(5, data.length) }, (_, i) => i);
  // Use endpoint-preserving, evenly-spaced labels, including single-point data.
  const tickIndexes = ticks.map((i) => ticks.length <= 1 ? 0 : Math.round(i / (ticks.length - 1) * (data.length - 1)));
  const total = data.reduce((sum, p) => sum + quantity(p.value), 0);
  const selectAt = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || !data.length) return;
    const i = Math.round(clamp((clientX - rect.left) / rect.width) * (data.length - 1));
    setActiveKey(data[i].key);
  };
  const number = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: max < 1 ? 3 : 0, notation: max >= 10000 ? "compact" : "standard" }).format(n);

  return <div className={styles.root}>
    <div className={styles.plotRow}>
      <div className={styles.axis} aria-hidden="true">
        {FRACTIONS.map((fraction) => <span key={fraction} style={{ bottom: `${fraction * 100}%` }}><AnimatedNumber value={max * fraction} format={formatAxis ?? number} /></span>)}
      </div>
      <div className={styles.plot} style={{ height }} ref={plot}>
        <ChartGrid fractions={FRACTIONS} />
        <canvas aria-hidden="true" className={cn(styles.canvas, styles.reveal)} ref={canvas} />
        {!total && <div className={styles.empty} style={{ height }}>{emptyLabel}</div>}
        {data.length > 0 && <div
          className={styles.scrubber} role="slider" tabIndex={0}
          aria-label={locale === "es" ? "Explorar gráfica" : "Explore chart"}
          aria-valuemin={0} aria-valuemax={Math.max(0, data.length - 1)} aria-valuenow={Math.max(0, active)}
          aria-valuetext={`${(point ?? data[0]).label}: ${(point ?? data[0]).value.toLocaleString(locale)}`}
          onPointerDown={(event) => selectAt(event.clientX)} onPointerMove={(event) => selectAt(event.clientX)}
          onPointerLeave={(event) => { if (!event.currentTarget.matches(":focus-visible")) setActiveKey(null); }}
          onFocus={() => setActiveKey(data[0].key)} onBlur={() => setActiveKey(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setActiveKey(null); return; }
            const index = Math.max(active, 0);
            const next = event.key === "Home" ? 0 : event.key === "End" ? data.length - 1 : event.key === "ArrowRight" ? Math.min(data.length - 1, index + 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : null;
            if (next !== null) { event.preventDefault(); setActiveKey(data[next].key); }
          }}
        />}
        {data.map((p, i) => markers?.has(p.key) ? <span aria-hidden="true" className={styles.annotation} key={p.key} style={{ left: `${data.length <= 1 ? 50 : i / (data.length - 1) * 100}%` }} /> : null)}
        <motion.div className={styles.crosshair} style={{ left: markerLeft }} animate={{ opacity: point ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.16 }} />
        <motion.div className={styles.marker} style={{ left: markerLeft, top: markerTop }} animate={{ opacity: point ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.16 }} />
        <motion.div aria-hidden="true" className={styles.readout} style={{ left: tooltipLeft, top: markerTop, width: 170, y: "calc(-100% - 13px)" }} animate={{ opacity: point ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>{point ? formatValue(point) : null}</motion.div>
      </div>
    </div>
    <div className={styles.dates} aria-hidden="true">{tickIndexes.map((i) => <span key={data[i].key}>{data[i].label}</span>)}</div>
    <ul className="sr-only">{data.map((p) => <li key={p.key}>{formatValue(p)}</li>)}</ul>
  </div>;
}
