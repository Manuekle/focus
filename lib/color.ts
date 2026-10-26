/**
 * Hex ↔ HSV, for controls where a colour is pointed at rather than typed.
 *
 * `#rrggbb` is how a colour is stored and pasted, but it is a poor space to
 * aim in: "the same colour, a bit darker" moves all three channels at once.
 * Every saturation/brightness square ever drawn is drawn in HSV, so the
 * conversion lives here and the picker's square, its hue rail and its hex
 * field all read the same numbers.
 */

export type Hsv = {
  /** 0-360. */
  readonly h: number;
  /** 0-1. */
  readonly s: number;
  /** 0-1. */
  readonly v: number;
};

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

/** `#abc`, `abc`, `#AABBCC` and stray whitespace all mean a colour; anything
 *  else means the caller keeps what it had. */
export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().toLowerCase();
  const candidate = raw.startsWith("#") ? raw : `#${raw}`;
  if (HEX6.test(candidate)) return candidate;
  if (HEX3.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`;
  }
  return fallback;
}

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}

export function hexToHsv(hex: string): Hsv {
  const safe = normalizeHex(hex, "#000000");
  const r = channel(safe, 0);
  const g = channel(safe, 1);
  const b = channel(safe, 2);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);

  let h = 0;
  if (span !== 0) {
    if (max === r) h = ((g - b) / span) % 6;
    else if (max === g) h = (b - r) / span + 2;
    else h = (r - g) / span + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : span / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector];
  const byte = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Relative luminance ≥ the midpoint, i.e. this colour wants dark text on it.
 *  Used to keep a handle or a label visible over whatever it lands on. */
export function isLightHex(hex: string): boolean {
  const safe = normalizeHex(hex, "#000000");
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance =
    0.2126 * linear(channel(safe, 0)) + 0.7152 * linear(channel(safe, 1)) + 0.0722 * linear(channel(safe, 2));
  return luminance > 0.45;
}
