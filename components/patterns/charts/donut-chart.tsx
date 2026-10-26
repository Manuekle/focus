"use client";

import { useRef, useState } from "react";
import { BLUE_RAMP, donutHoverOffset, donutSlice, exponentialOut, flow, hash, HoverTween, ringPath, shares, smoothstep, TAU, VectorTween } from "./geometry";
import { AnimatedNumber } from "./primitives";
import { useTileCanvas } from "./use-tile-canvas";
import type { RankedBar } from "./types";
import styles from "./tiles.module.css";

export function DonutChart({ data, emptyLabel }: { readonly data: readonly RankedBar[]; readonly emptyLabel: string }) {
  const signature = data.map((p) => `${p.key}:${p.value}`).join("|");
  const [selection, setSelection] = useState<{ key: string; signature: string } | null>(null);
  const hover = selection?.signature === signature ? selection.key : null;
  const setHover = (key: string | null) => setSelection((old) => key === null ? null : old?.key === key && old.signature === signature ? old : { key, signature });
  const target = shares(data.map((p) => p.value));
  const state = useRef({ keys: data.map((p) => p.key), tween: new VectorTween(target) });
  const paths = useRef<{ key: string; path: Path2D; dx: number; dy: number }[]>([]);
  const hoverTween = useRef(new HoverTween(0.72));
  const { canvas } = useTileCanvas(({ ctx, width, height, now, time, reduced }) => {
    const keys = data.map((p) => p.key);
    hoverTween.current.retain(keys);
    const previous = state.current;
    if (keys.join("\0") !== previous.keys.join("\0")) {
      const aligned = keys.map((key) => previous.tween.displayed[previous.keys.indexOf(key)] ?? 0);
      // Renormalize surviving categories before morphing, keeping one full ring.
      previous.tween = new VectorTween(shares(aligned).some(Boolean) ? shares(aligned) : target);
      previous.keys = keys;
    }
    previous.tween.retarget(target, now, 500, exponentialOut);
    const displayed = previous.tween.read(now, reduced);
    const size = Math.min(width, height);
    ctx.translate((width - size) / 2, (height - size) / 2);
    ctx.scale(size / 200, size / 200);
    let start = -Math.PI / 2;
    paths.current = [];
    displayed.forEach((share, i) => {
      const { mid } = donutSlice(start, share);
      const active = hover === data[i].key;
      const [emphasis, opacity] = hoverTween.current.read(data[i].key, active ? 1 : 0, active ? 1 : hover ? 0.216 : 0.72, now, reduced);
      const color = BLUE_RAMP[Math.min(i, 4)];
      const path = ringPath(start, share);
      const [dx, dy] = donutHoverOffset(mid, emphasis, target.filter((share) => share > 0).length);
      paths.current.push({ key: data[i].key, path, dx, dy });
      ctx.save();
      ctx.translate(dx, dy);
      ctx.shadowColor = `${color}${Math.round(140 * emphasis).toString(16).padStart(2, "0")}`;
      ctx.shadowBlur = 5 * emphasis;
      ctx.clip(path);
      const tiles = new Path2D();
      const cell = 4.6;
      for (let x = 12; x < 188; x += cell) for (let y = 12; y < 188; y += cell) {
        const px = x + cell / 2;
        const py = y + cell / 2;
        const radius = Math.hypot(px - 100, py - 100);
        if (radius < 53 || radius > 88) continue;
        const angle = ((Math.atan2(py - 100, px - 100) - start) % TAU + TAU) % TAU;
        if (angle > share * TAU + 0.03) continue;
        const fullness = 0.62 + 0.38 * smoothstep((radius - 55) / 31);
        const size = cell * (0.34 + 0.12 * emphasis + 0.36 * fullness + 0.26 * flow(x, y, time)) * (0.78 + 0.42 * hash(x, y));
        tiles.rect(px - size / 2, py - size / 2, size, size);
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.fill(tiles);
      ctx.restore();
      start += share * TAU;
    });
  }, target.some(Boolean));

  return <div className={`${styles.root} ${styles.donut}`}>
    <div className={styles.ring}>
      <canvas aria-hidden="true" className={styles.canvas} ref={canvas} onPointerLeave={() => setHover(null)} onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * 200;
        const y = (event.clientY - rect.top) / rect.height * 200;
        const ctx = event.currentTarget.getContext("2d");
        if (!ctx) return;
        // isPointInPath uses the current transform; hit test in logical space.
        ctx.save(); ctx.resetTransform();
        // Include the resting wedge, so its animated lift cannot evict the pointer.
        const found = paths.current.find((slice) => ctx.isPointInPath(slice.path, x - slice.dx, y - slice.dy) || ctx.isPointInPath(slice.path, x, y));
        ctx.restore();
        setHover(found?.key ?? null);
      }} />
      {!target.some(Boolean) && <div className={styles.empty} style={{ height: "100%" }}>{emptyLabel}</div>}
    </div>
    <ul className={styles.legend}>{data.map((plan, i) => <li key={plan.key}>
      <button type="button" data-active={hover === plan.key} style={{ opacity: hover && hover !== plan.key ? 0.5 : 1 }} onPointerEnter={() => setHover(plan.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(plan.key)} onBlur={() => setHover(null)} onKeyDown={(e) => { if (e.key === "Escape") setHover(null); }}>
        <span aria-hidden="true" className={styles.swatch} style={{ background: BLUE_RAMP[Math.min(i, 4)] }} />
        <span className={styles.legendLabel}>{plan.label}</span>
        <span className={styles.legendValue}>{plan.formatValue ? <AnimatedNumber value={plan.value} format={plan.formatValue} /> : plan.formatted}</span>
      </button>
    </li>)}</ul>
  </div>;
}
