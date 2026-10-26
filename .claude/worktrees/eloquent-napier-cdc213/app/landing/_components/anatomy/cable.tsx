import { pathOf, type Flat } from "@/components/iso/iso-kit";

/**
 * A cable lying on the bench: a round sheath drawn as two strokes, its edge
 * and its lighter core, along a route whose corners are bent rather than
 * kinked. A single line with sharp corners read as an outline drawn on the
 * bench, not as something lying on it.
 */

/** `points` with every inner corner replaced by a bend of up to `radius` (screen units). */
export function bentPath(points: readonly Flat[], radius: number) {
  if (points.length < 3) return pathOf([...points]);
  const at = (point: Flat) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
  let d = `M${at(points[0]!)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const [px, py] = points[index - 1]!;
    const [cx, cy] = points[index]!;
    const [nx, ny] = points[index + 1]!;
    const before = Math.hypot(cx - px, cy - py);
    const after = Math.hypot(nx - cx, ny - cy);
    const cut = Math.min(radius, before * 0.45, after * 0.45);
    const enter: Flat = [cx - ((cx - px) / (before || 1)) * cut, cy - ((cy - py) / (before || 1)) * cut];
    const leave: Flat = [cx + ((nx - cx) / (after || 1)) * cut, cy + ((ny - cy) / (after || 1)) * cut];
    d += `L${at(enter)}Q${at([cx, cy])} ${at(leave)}`;
  }
  return `${d}L${at(points[points.length - 1]!)}`;
}

export function Cable({ points, radius = 3 }: { readonly points: readonly Flat[]; readonly radius?: number }) {
  const d = bentPath(points, radius);
  return (
    <g className="lp-cable">
      <path className="lp-cable-edge" d={d} />
      <path className="lp-cable-core" d={d} />
    </g>
  );
}
