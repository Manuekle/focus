"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TileFrame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  now: number;
  time: number;
  reduced: boolean;
};

/** One canvas lifecycle: no React updates per frame, no hidden/offscreen work. */
export function useTileCanvas(draw: (frame: TileFrame) => void, animated = true) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const invalidateRef = useRef<() => void>(() => {});
  const [reduced, setReduced] = useState(true);
  const invalidate = useCallback(() => invalidateRef.current(), []);

  useLayoutEffect(() => {
    drawRef.current = draw;
    invalidate();
  });

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = true;
    let time = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const render = (now: number) => {
      frame = 0;
      if (!visible || document.hidden || !width || !height) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      // Empty series stop their loop; finish geometry too, rather than freezing stale marks.
      drawRef.current({ ctx, width, height, now, time, reduced: media.matches || !animated });
      ctx.restore();
      if (!media.matches && animated) {
        time += 0.02;
        frame = requestAnimationFrame(render);
      }
    };
    const invalidate = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render);
    };
    invalidateRef.current = invalidate;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.ceil(width * dpr);
      element.height = Math.ceil(height * dpr);
      invalidate();
    };
    const preference = () => { setReduced(media.matches); invalidate(); };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visibility();
    });
    observer.observe(element);
    intersection.observe(element);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", preference);
    preference();
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", preference);
      invalidateRef.current = () => {};
    };
  }, [animated]);

  return { canvas, invalidate, reduced };
}
