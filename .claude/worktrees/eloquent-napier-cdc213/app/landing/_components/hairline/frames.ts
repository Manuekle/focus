import type { FigureFrame } from "./figure-stage";

/**
 * The band of the 400 × 320 stage each figure is shown in. Every capability
 * figure draws inside the same band — the stacked ones fill it with their
 * levels, the ones on one floor with their callouts above and below — so the
 * six cards hold drawings of one size. Kept apart from the figures so the
 * placeholder that waits for them can take the same shape.
 */
export const CAPABILITY_FRAME: FigureFrame = [32, 300];
/** The machine has no callouts, so it is cropped at the sides as well, and drawn that much larger. */
export const SERVER_FRAME: FigureFrame = [18, 312, 40, 360];

/** The CSS aspect ratio of a frame at the stage's full width. */
export const frameAspect = ([top, bottom, left = 0, right = 400]: FigureFrame) => `${right - left} / ${bottom - top}`;
