"use client";

import { useRef, useState } from "react";
import { BLUE_RAMP, cubicOut, flow, hash, HoverTween, quantity, smoothstep, VectorTween } from "./geometry";
import { AnimatedNumber } from "./primitives";
import { useTileCanvas } from "./use-tile-canvas";
import { toneColor, type ChartTone, type RankedBar } from "./types";
import styles from "./tiles.module.css";

export function RankedBars({ bars, emptyLabel, limit = 6, tone = "neutral" }: {
  readonly bars: readonly RankedBar[];
  readonly emptyLabel: string;
  readonly limit?: number;
  readonly tone?: ChartTone;
}) {
  const ranked = [...bars].sort((a, b) => quantity(b.value) - quantity(a.value)).slice(0, limit);
  const [hover, setHover] = useState<string | null>(null);
  const tweens = useRef(new Map<string, VectorTween>());
  const hoverTween = useRef(new HoverTween());
  const max = Math.max(...ranked.map((b) => quantity(b.value)), 0) || 1;
  const { canvas } = useTileCanvas(({ ctx, width, height, now, time, reduced }) => {
    const rowHeight = (height - Math.max(0, ranked.length - 1) * 9) / Math.max(1, ranked.length);
    hoverTween.current.retain(ranked.map((bar) => bar.key));
    for (const key of tweens.current.keys()) if (!ranked.some((b) => b.key === key)) tweens.current.delete(key);
    ranked.forEach((bar, i) => {
      let tween = tweens.current.get(bar.key);
      if (!tween) { tween = new VectorTween([0]); tweens.current.set(bar.key, tween); }
      tween.retarget([quantity(bar.value) / max], now + i * 31, 620, cubicOut);
      const fillWidth = width * tween.read(now, reduced)[0];
      const [emphasis, opacity] = hoverTween.current.read(bar.key, hover === bar.key ? 1 : 0, hover && hover !== bar.key ? 0.3 : 1, now, reduced);
      if (fillWidth <= 0) return;
      const top = i * (rowHeight + 9) + rowHeight - 26;
      const path = new Path2D();
      path.roundRect(0, top, fillWidth, 26, Math.min(5, fillWidth / 2));
      ctx.save();
      ctx.clip(path);
      const tiles = new Path2D();
      const cell = 3.4;
      for (let x = 0; x < fillWidth; x += cell) for (let y = top; y < top + 26; y += cell) {
        const fullness = smoothstep((x + cell) / Math.max(fillWidth, 1));
        const size = cell * (0.35 + 0.15 * emphasis + 0.3 * fullness + 0.2 * flow(x, y, time)) * (0.8 + 0.3 * hash(x, y));
        tiles.rect(x + (cell - size) / 2, y + (cell - size) / 2, size, size);
      }
      ctx.fillStyle = (bar.tone ?? tone) === "neutral" ? BLUE_RAMP[Math.min(i, 4)] : toneColor(bar.tone ?? tone);
      ctx.globalAlpha = opacity;
      ctx.fill(tiles);
      ctx.restore();
    });
  }, ranked.some((bar) => bar.value > 0));

  return <div className={styles.root} style={{ position: "relative" }}>
    {!ranked.length && <p className="text-muted-foreground text-xs">{emptyLabel}</p>}
    <ul className={styles.rankList}>
      {ranked.map((bar) => <li key={bar.key}>
        <button type="button" className={styles.rankButton} style={{ opacity: hover && hover !== bar.key ? 0.5 : 1 }} onPointerEnter={() => setHover(bar.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(bar.key)} onBlur={() => setHover(null)} onKeyDown={(e) => { if (e.key === "Escape") setHover(null); }}>
          <span className={styles.rankLabel}><span>{bar.label}</span><span>{bar.formatValue ? <AnimatedNumber value={bar.value} format={bar.formatValue} /> : bar.formatted}</span></span>
          <span className={styles.rankPlot} style={{ display: "block" }} aria-hidden="true" />
        </button>
      </li>)}
    </ul>
    <canvas aria-hidden="true" ref={canvas} className={styles.canvas} style={{ pointerEvents: "none" }} />
  </div>;
}
