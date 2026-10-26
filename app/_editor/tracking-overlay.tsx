"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { decodeMaskToRaster } from "@meta-sam/parser";
import { clientToSource, frameIndexAt } from "../../shared/coords";
import { frameAt, type FrameObject, type Tracking } from "../../shared/tracking";

type Tint = "selected" | "candidate" | "diagnostic";

const TINTS: Record<Tint, readonly [number, number, number, number]> = {
  // #325CFE, the Focus blue.
  selected: [50, 92, 254, 120],
  candidate: [255, 255, 255, 80],
  diagnostic: [50, 92, 254, 90],
};

/** Draws masks on a canvas sized to the normalized video, so pixels line up 1:1. */
export function TrackingOverlay({
  videoRef,
  tracking,
  selection,
  mode,
  diagnostic,
  marker,
  onPick,
  onFrame,
}: {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly tracking: Tracking;
  readonly selection: readonly string[];
  /** "pick": clicks choose objects; "view": the overlay ignores the pointer. */
  readonly mode: "pick" | "view";
  readonly diagnostic: boolean;
  readonly marker?: { readonly x: number; readonly y: number } | null;
  readonly onPick?: (point: { x: number; y: number }, frameIndex: number) => void;
  readonly onFrame?: (frameIndex: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const frameRef = useRef(0);
  const selected = useMemo(() => new Set(selection), [selection]);

  // A new tracking means new masks.
  useEffect(() => cache.current.clear(), [tracking]);

  const tintedMask = (frameIndex: number, object: FrameObject, tint: Tint): HTMLCanvasElement | null => {
    if (!object.mask) return null;
    const key = `${frameIndex}:${object.objectId}:${tint}`;
    const hit = cache.current.get(key);
    if (hit) return hit;
    const raster = decodeMaskToRaster(object.mask);
    const canvas = document.createElement("canvas");
    canvas.width = object.mask.width;
    canvas.height = object.mask.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(canvas.width, canvas.height);
    const [r, g, b, a] = TINTS[tint];
    for (let index = 0; index < raster.length; index++) {
      if (raster[index] !== 1) continue;
      const offset = index * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = a;
    }
    context.putImageData(image, 0, 0);
    if (cache.current.size > 2000) cache.current.clear();
    cache.current.set(key, canvas);
    return canvas;
  };

  const draw = (frameIndex: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const frame = frameAt(tracking, frameIndex);
    if (!frame) return;
    const lineWidth = Math.max(2, Math.round(tracking.width / 400));
    for (const object of frame.objects) {
      const isSelected = selected.has(object.objectId);
      const tint: Tint = isSelected ? "selected" : diagnostic ? "diagnostic" : "candidate";
      if (!isSelected && !diagnostic && mode !== "pick") continue;
      const { left, top, right, bottom } = object.box;
      const mask = tintedMask(frameIndex, object, tint);
      if (mask) context.drawImage(mask, left, top, right - left, bottom - top);
      if (diagnostic || (mode === "pick" && !isSelected)) {
        context.lineWidth = lineWidth;
        context.setLineDash(isSelected ? [] : [lineWidth * 3, lineWidth * 2]);
        context.strokeStyle = isSelected ? "#325cfe" : "rgba(255,255,255,0.9)";
        context.strokeRect(left + lineWidth / 2, top + lineWidth / 2, right - left - lineWidth, bottom - top - lineWidth);
      }
      if (diagnostic) {
        const label = `#${object.objectId}${object.confidence !== null ? ` ${object.confidence.toFixed(2)}` : ""}${object.mask ? "" : " no mask"}`;
        const size = Math.max(12, Math.round(tracking.width / 70));
        context.font = `600 ${size}px "Inter", sans-serif`;
        const width = context.measureText(label).width + size * 0.8;
        context.setLineDash([]);
        context.fillStyle = isSelected ? "#325cfe" : "rgba(20,22,30,0.85)";
        context.fillRect(left, Math.max(0, top - size * 1.5), width, size * 1.5);
        context.fillStyle = "#ffffff";
        context.fillText(label, left + size * 0.4, Math.max(size * 1.1, top - size * 0.4));
      }
    }
    if (marker) {
      const radius = Math.max(6, Math.round(tracking.width / 120));
      context.setLineDash([]);
      context.beginPath();
      context.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
      context.fillStyle = "#325cfe";
      context.fill();
      context.lineWidth = lineWidth;
      context.strokeStyle = "#ffffff";
      context.stroke();
    }
  };

  // Frame-accurate sync: requestVideoFrameCallback reports the presented
  // frame's media time; the rAF fallback reads currentTime.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let handle = 0;
    let stopped = false;
    const update = (mediaTime: number) => {
      const index = frameIndexAt(mediaTime, tracking.fps, tracking.frameCount);
      if (index !== frameRef.current) {
        frameRef.current = index;
        onFrame?.(index);
      }
      draw(index);
    };
    if ("requestVideoFrameCallback" in video) {
      const loop = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (stopped) return;
        update(metadata.mediaTime);
        handle = video.requestVideoFrameCallback(loop);
      };
      handle = video.requestVideoFrameCallback(loop);
      update(video.currentTime);
      return () => {
        stopped = true;
        video.cancelVideoFrameCallback(handle);
      };
    }
    const loop = () => {
      if (stopped) return;
      update((video as HTMLVideoElement).currentTime);
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(handle);
    };
    // draw reads the latest props through closure; re-subscribe when they change.
  });

  // Redraw on prop changes while paused (no new frames are presented then).
  useEffect(() => {
    draw(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, diagnostic, mode, marker, tracking]);

  return (
    <canvas
      ref={canvasRef}
      width={tracking.width}
      height={tracking.height}
      aria-hidden={mode !== "pick"}
      aria-label={mode === "pick" ? "Click the subject you want to highlight" : undefined}
      onClick={(event) => {
        if (mode !== "pick" || !onPick) return;
        event.stopPropagation();
        const point = clientToSource(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), tracking, "fill");
        if (point) onPick(point, frameRef.current);
      }}
      className={mode === "pick" ? "absolute inset-0 h-full w-full cursor-crosshair" : "pointer-events-none absolute inset-0 h-full w-full"}
    />
  );
}
