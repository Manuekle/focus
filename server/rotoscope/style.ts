import type { Rgba } from "./alpha";
import type { Check } from "./run-state";

// The drawing's line work, measured: share of the figure's pixels that sit on a hard
// edge (an outline or a colour border). A drawing that drifts toward soft shading and
// thin or lost outlines has far fewer of them than the cel-style frames it must match,
// which a model reviewer lets through because the drawing still looks nicer.

/** Luminance step across a pixel that counts as a hard edge. */
const HARD_EDGE = 60;
/** How far the density may fall short of the anchor's, or exceed it, before the style counts as changed. */
const LOWEST = 0.82;
const HIGHEST = 1.3;

/** Share (0–1) of the figure's pixels on a hard edge; pixels beside the cutout's border are skipped. */
export function outlineDensity(image: Rgba): number {
  const { width, height, data } = image;
  const luminance = (p: number) => 0.3 * data[p * 4] + 0.59 * data[p * 4 + 1] + 0.11 * data[p * 4 + 2];
  let figure = 0;
  let hard = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (data[p * 4 + 3] < 250) continue;
      if ([p - 1, p + 1, p - width, p + width].some((q) => data[q * 4 + 3] < 250)) continue;
      figure++;
      if (Math.abs(luminance(p + 1) - luminance(p - 1)) + Math.abs(luminance(p + width) - luminance(p - width)) > HARD_EDGE) hard++;
    }
  }
  return figure ? hard / figure : 0;
}

/** Line work against the run's first approved drawing; passes when the line style is the same. */
export function checkStyle(image: Rgba, anchorDensity: number): Check {
  const density = outlineDensity(image);
  const ratio = anchorDensity > 0 ? density / anchorDensity : 1;
  const detail = `outlines ${(ratio * 100).toFixed(0)} % of the approved frames' average (${(density * 100).toFixed(1)} % vs ${(anchorDensity * 100).toFixed(1)} % of the figure)`;
  if (ratio >= LOWEST && ratio <= HIGHEST) return { name: "style", passed: true, detail, score: Math.round(Math.abs(1 - ratio) * 1000) / 1000 };
  return {
    name: "style",
    passed: false,
    detail,
    score: Math.round(Math.abs(1 - ratio) * 1000) / 1000,
    feedback: ratio < LOWEST
      ? "The drawing is rendered softer than the style anchor: thin or missing black outlines, soft shading. Draw the same bold black outlines and flat cel colours as the style anchor, with no gradients or glossy highlights."
      : "The drawing has far more line work than the style anchor: too many hatching, shading or detail lines. Draw the same outlines and flat cel colours as the style anchor, nothing busier.",
  };
}
