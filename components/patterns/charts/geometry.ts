/** Geometry is independent of React and canvas so data transitions can be tested. */
export const BLUE_RAMP = ["#2563EB", "#4C7BEF", "#6E96F3", "#93B4F6", "#AFC7F9"];
export const TAU = Math.PI * 2;
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const quantity = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x); };
export const cubicOut = (t: number) => 1 - (1 - t) ** 3;
export const exponentialOut = (t: number) => t >= 1 ? 1 : 1 - 2 ** (-10 * t);
export const HOVER_ENTER_MS = 180;
export const HOVER_EXIT_MS = 260;
export const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
export const flow = (x: number, y: number, time: number) => smoothstep(
  0.5 + (Math.sin(x * 0.09 + time) + Math.sin(y * 0.13 - time * 0.7) + Math.sin((x + y) * 0.05 + time * 0.6)) / 6,
);

export function shares(values: readonly number[]) {
  const clean = values.map(quantity);
  const total = clean.reduce((a, b) => a + b, 0);
  return clean.map((value) => total ? value / total : 0);
}

export function sampleCurve(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const at = clamp(fraction) * (values.length - 1);
  const index = Math.floor(at);
  return mix(quantity(values[index]), quantity(values[Math.min(index + 1, values.length - 1)]), smoothstep(at - index));
}

export function niceMax(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const padded = value * 1.05;
  const power = 10 ** Math.floor(Math.log10(padded));
  return ([1, 2, 5, 10].find((n) => n * power >= padded) ?? 10) * power;
}

/** Retargeting captures the displayed vector, including interrupted animations. */
export class VectorTween {
  displayed: number[];
  from: number[];
  target: number[];
  start = 0;
  duration = 0;
  ease: (t: number) => number = (t) => t;

  constructor(values: readonly number[]) {
    this.displayed = [...values];
    this.from = [...values];
    this.target = [...values];
  }

  retarget(values: readonly number[], now: number, duration: number, ease = this.ease) {
    if (values.length === this.target.length && values.every((v, i) => v === this.target[i])) return;
    this.from = values.map((_, i) => this.displayed[i] ?? 0);
    this.target = [...values];
    this.start = now;
    this.duration = duration;
    this.ease = ease;
  }

  read(now: number, reduced = false) {
    const progress = reduced || !this.duration ? 1 : clamp((now - this.start) / this.duration);
    this.displayed = progress === 1 ? [...this.target] : this.target.map((target, i) => mix(this.from[i] ?? 0, target, this.ease(progress)));
    return this.displayed;
  }
}

/** Hover is independent of data morphing: never reset geometry on pointer events. */
export class HoverTween {
  private values = new Map<string, VectorTween>();
  constructor(private restOpacity = 1) {}

  read(key: string, emphasis: number, opacity: number, now: number, reduced: boolean) {
    let tween = this.values.get(key);
    if (!tween) {
      tween = new VectorTween([0, this.restOpacity]);
      this.values.set(key, tween);
    }
    tween.retarget([emphasis, opacity], now, emphasis > 0 ? HOVER_ENTER_MS : HOVER_EXIT_MS, cubicOut);
    return tween.read(now, reduced);
  }

  retain(keys: readonly string[]) {
    const live = new Set(keys);
    for (const key of this.values.keys()) if (!live.has(key)) this.values.delete(key);
  }
}

export function blendColor(from: string, to: string, amount: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${[1, 3, 5].map((i) => Math.round(mix(channel(from, i), channel(to, i), clamp(amount)))).join(",")})`;
}

export function donutSlice(start: number, share: number) {
  const sweep = quantity(share) * TAU;
  const gap = Math.min(0.07, sweep * 0.25);
  const a = start + gap / 2;
  const b = start + sweep - gap / 2;
  // Inner circumference is the tighter constraint on thin slices.
  const corner = Math.min(6, Math.max(0, (b - a) * 55 / 4), (86 - 55) / 2);
  return { a, b, corner, mid: start + sweep / 2 };
}

export function donutHoverOffset(mid: number, emphasis: number, count: number) {
  // A single slice is the whole chart, not a piece to pull away from its peers.
  const distance = count > 1 ? 6 * emphasis : 0;
  return [Math.cos(mid) * distance, Math.sin(mid) * distance] as const;
}

export function ringPath(start: number, share: number): Path2D {
  const path = new Path2D();
  if (share <= 0) return path;
  const { a, b, corner: r } = donutSlice(start, share);
  const point = (radius: number, angle: number) => [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)] as const;
  path.moveTo(...point(86, a + r / 86));
  path.arc(100, 100, 86, a + r / 86, b - r / 86);
  path.quadraticCurveTo(...point(86, b), ...point(86 - r, b));
  path.lineTo(...point(55 + r, b));
  path.quadraticCurveTo(...point(55, b), ...point(55, b - r / 55));
  path.arc(100, 100, 55, b - r / 55, a + r / 55, true);
  path.quadraticCurveTo(...point(55, a), ...point(55 + r, a));
  path.lineTo(...point(86 - r, a));
  path.quadraticCurveTo(...point(86, a), ...point(86, a + r / 86));
  path.closePath();
  return path;
}

export type StackRect = { column: number; band: number; x: number; y: number; width: number; height: number };
export function stackRects(values: readonly (readonly number[])[], width: number, height: number, max: number): StackRect[] {
  const columnWidth = width / Math.max(values.length, 1);
  const barWidth = Math.min(columnWidth * 0.62, 54);
  return values.flatMap((bands, column) => {
    const nonzero = bands.filter((v) => v > 0).length;
    const plotHeight = Math.max(0, height - Math.max(0, nonzero - 1) * 4);
    let bottom = height;
    return bands.map((value, band) => {
      const bandHeight = value > 0 ? Math.max(0, value / max * plotHeight) : 0;
      const rect = { column, band, x: columnWidth * (column + 0.5) - barWidth / 2, y: bottom - bandHeight, width: barWidth, height: bandHeight };
      if (bandHeight) bottom -= bandHeight + 4;
      return rect;
    });
  });
}

export function hitStack(rects: readonly StackRect[], x: number, y: number, width: number, count: number) {
  if (!count || x < 0 || x > width) return null;
  const column = Math.min(count - 1, Math.floor(x / width * count));
  const rect = rects.find((r) => r.column === column && r.height > 0 && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
  return { column, band: rect?.band ?? null };
}
