// Picture sizes the media routes resize to (`?w=`). A handful of steps keeps every
// strip, card and avatar on a few cached copies instead of one per pixel width.
export const THUMB_WIDTHS = [160, 320, 640, 1280] as const;

/** The smallest step at least as wide as asked (the largest past it); undefined when nothing valid was asked. */
export function thumbWidth(value: number | string | null | undefined): number | undefined {
  const asked = typeof value === "string" ? (/^\d{1,5}$/.test(value) ? Number(value) : NaN) : value ?? NaN;
  if (!Number.isFinite(asked) || asked <= 0) return undefined;
  return THUMB_WIDTHS.find((step) => step >= asked) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

/** A media URL asking for a copy about `width` CSS pixels wide (twice that for sharp screens). */
export function thumbUrl(url: string, width: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}w=${thumbWidth(width * 2)}`;
}
