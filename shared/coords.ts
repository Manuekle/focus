/**
 * Converts a pointer position on a displayed video to source-pixel coordinates.
 *
 * `rect` is the element's box (getBoundingClientRect). With `object-fit:
 * contain` the media is letterboxed inside that box; with `fill` it stretches.
 * Returns null when the point falls on the letterbox bars.
 */
export function clientToSource(
  clientX: number,
  clientY: number,
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  media: { readonly width: number; readonly height: number },
  fit: "contain" | "fill" = "contain",
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  let shownWidth = rect.width;
  let shownHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (fit === "contain") {
    const scale = Math.min(rect.width / media.width, rect.height / media.height);
    shownWidth = media.width * scale;
    shownHeight = media.height * scale;
    offsetX = (rect.width - shownWidth) / 2;
    offsetY = (rect.height - shownHeight) / 2;
  }
  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX >= shownWidth || localY >= shownHeight) return null;
  return {
    x: Math.max(0, Math.min(media.width - 1, Math.floor((localX * media.width) / shownWidth))),
    y: Math.max(0, Math.min(media.height - 1, Math.floor((localY * media.height) / shownHeight))),
  };
}

/**
 * The normalized-video frame shown at a media time (CFR, first frame at t=0).
 * Frame i is on screen from i/fps until (i+1)/fps; the epsilon absorbs the
 * float error of a presentation timestamp landing exactly on i/fps.
 */
export function frameIndexAt(mediaTime: number, fps: number, frameCount: number): number {
  return Math.max(0, Math.min(frameCount - 1, Math.floor(mediaTime * fps + 1e-3)));
}
