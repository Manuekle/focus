import { flipbookUrls, type Flipbook, type FlipbookFrame } from "../../shared/flipbook";

export function frameThumb(flipbook: Flipbook, frame: FlipbookFrame): string | null {
  const transform = flipbook.alignment?.transforms[frame.id];
  // The registered sprite of the current drawing, also while a redraw of it is running.
  if (transform && transform.version === frame.version) return flipbookUrls.sprite(flipbook.id, frame.id, transform.key);
  return null;
}
