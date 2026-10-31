"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./rotoscope.module.css";

export const DOCK_DEFAULT = 400;
export const DOCK_MIN = 320;
export const DOCK_MAX = 720;
/** The canvas keeps at least this much room beside the inspector. */
const CANVAS_MIN = 360;
const WIDTH_KEY = "focus.rotoscope.dock.width";
const STEP = 16;

const clamp = (value: number, room = Infinity) => Math.round(Math.max(DOCK_MIN, Math.min(DOCK_MAX, room, value)));

/**
 * The run inspector's width, dragged or keyed by the person like the studio sidebar (sidebar-resizer.tsx) and
 * remembered in this browser under `storageKey` (Flipbook keeps its own). Storage is a convenience only: every read and write may fail.
 */
export function useDockWidth(storageKey = WIDTH_KEY) {
  const [width, setWidth] = useState(DOCK_DEFAULT);
  const [dragging, setDragging] = useState(false);
  // Before the first paint, so a reload shows the saved width at once instead of easing to it from the default.
  useLayoutEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) setWidth(clamp(saved));
    } catch {
      // Private window or blocked storage: the default stands.
    }
  }, [storageKey]);
  const commit = useCallback((next: number, room?: number) => {
    const value = clamp(next, room);
    setWidth(value);
    try {
      window.localStorage.setItem(storageKey, String(value));
    } catch {
      // Not remembered; still applied.
    }
  }, [storageKey]);
  return {
    width,
    dragging,
    setDragging,
    preview: (next: number, room?: number) => setWidth(clamp(next, room)),
    commit,
    /** Spread on the workspace: the dock reads its width from here. */
    style: { "--dock-user": `${width}px` } as CSSProperties,
  };
}

type Dock = ReturnType<typeof useDockWidth>;

/** The inspector's left edge: drag it (left widens), arrow keys resize it, double click resets. */
export function DockResizer({ dock }: { readonly dock: Dock }) {
  const start = useRef<{ x: number; width: number; room: number } | null>(null);
  const roomOf = (element: HTMLElement) => (element.parentElement?.clientWidth ?? Infinity) - CANVAS_MIN;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: dock.width, room: roomOf(event.currentTarget) };
    dock.setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current) dock.preview(start.current.width + start.current.x - event.clientX, start.current.room);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    dock.commit(start.current.width + start.current.x - event.clientX, start.current.room);
    start.current = null;
    dock.setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "ArrowLeft" ? dock.width + STEP : event.key === "ArrowRight" ? dock.width - STEP : event.key === "Home" ? DOCK_MIN : event.key === "End" ? DOCK_MAX : null;
    if (next === null) return;
    event.preventDefault();
    dock.commit(next, roomOf(event.currentTarget));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector"
      aria-valuemin={DOCK_MIN}
      aria-valuemax={DOCK_MAX}
      aria-valuenow={dock.width}
      tabIndex={0}
      className={styles.dockResizer}
      data-dragging={dock.dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => dock.commit(DOCK_DEFAULT)}
    />
  );
}
