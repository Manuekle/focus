"use client";

import { useRef } from "react";
import { flow, sampleCurve, VectorTween } from "./geometry";
import { toneColor, type ChartTone } from "./types";
import { useTileCanvas } from "./use-tile-canvas";

/** KPI sparkline: keep signed inputs (SEO position is intentionally negated). */
export function MiniTrend({ points, tone }: { points: readonly number[]; tone: ChartTone }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const values = Array.from({ length: 80 }, (_, i) => {
    const normalized = points.map((v) => max === min ? 0.5 : (v - min) / (max - min));
    return sampleCurve(normalized, i / 79);
  });
  const tween = useRef(new VectorTween(values));
  const { canvas } = useTileCanvas(({ ctx, width, height, now, time, reduced }) => {
    tween.current.retarget(values, now, 460);
    const curve = tween.current.read(now, reduced);
    const tiles = new Path2D();
    for (let x = 0; x < width; x += 3) {
      const ceiling = height - 3 - sampleCurve(curve, x / width) * (height - 6);
      for (let y = Math.ceil(ceiling / 3) * 3; y < height; y += 3) {
        const size = 1 + flow(x, y, time) * 0.7;
        tiles.rect(x, y, size, size);
      }
    }
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = toneColor(tone);
    ctx.fill(tiles);
  }, points.length > 1);
  return <canvas ref={canvas} aria-hidden="true" className="block h-6 w-full" />;
}
