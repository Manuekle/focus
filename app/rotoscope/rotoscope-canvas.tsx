"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  GridViewIcon,
  ArrowExpand01Icon,
  CenterFocusIcon,
  PanelRightOpenIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { rotoscopeUrls, type RotoscopeFrame, type RotoscopeRun } from "../../shared/rotoscope";
import { AttemptTray, TRAY_RESERVE, trayItems } from "./attempt-tray";
import { STATE_LABEL, frameState, time } from "./frame-state";
import styles from "./rotoscope-canvas.module.css";

const CARD_W = 128;
const CARD_H = 187;
const GAP_X = 40;
const GAP_Y = 44;
const PAD = 96;
const MIN_ZOOM = 0.04;
const MAX_ZOOM = 1.8;
const FIT_MAX = 0.9;
/** Room the floating toolbar above and the drawing controls below take from a fit. */
const FIT_TOP = 56;
const FIT_BOTTOM = 64;
const INITIAL_ZOOM = 0.7;
/** The smallest fit that still reads as a sheet of drawings; below it the view opens on the current frame instead. */
const FIT_READABLE = 0.4;
const DETAIL_ZOOM = 0.24;
const DRAG_THRESHOLD = 4;
const PAN_MARGIN = 48;
const EDGE_PAN = 56;
const EDGE_PAN_SPEED = 11;
const CULL_MARGIN = 600;
const MINIMAP_W = 168;
const MINIMAP_H = 112;
const MINIMAP_PAD = 8;

type XY = { readonly x: number; readonly y: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Frame sheets stay roughly square: fewer columns on a short run, more on a long one. */
function columnsFor(total: number) {
  if (total <= 1) return 1;
  if (total <= 4) return total;
  if (total <= 12) return 4;
  if (total <= 48) return 8;
  return 10;
}

function readMoved(runId: string): Record<number, XY> {
  try {
    const raw = window.localStorage.getItem(`focus:rotoscope:canvas:${runId}`);
    return raw ? (JSON.parse(raw) as Record<number, XY>) : {};
  } catch {
    return {};
  }
}

function writeMoved(runId: string, moved: Record<number, XY>) {
  try {
    window.localStorage.setItem(`focus:rotoscope:canvas:${runId}`, JSON.stringify(moved));
  } catch {
    // Private mode and full storage both fail here; the canvas still works.
  }
}

/**
 * The run as a free canvas, the way a diagram tool works: wheel pans,
 * ⌘/ctrl+wheel zooms into the pointer, drag on the background to move around,
 * drag a frame card to place it. Positions are remembered per run, and the
 * minimap keeps a long run navigable.
 *
 * It is deliberately built from DOM + CSS transforms, like the automation
 * canvas it is modelled on: no canvas library, and the frame cards stay real
 * buttons with real images.
 */
export function RotoscopeCanvas({
  run,
  selected,
  onSelect,
  dockOpen,
  onToggleDock,
  actions,
  viewing,
  onPickAttempt,
}: {
  readonly run: RotoscopeRun;
  /** One-based frame index, or null before the run has frames. */
  readonly selected: number | null;
  readonly onSelect: (index: number) => void;
  readonly dockOpen: boolean;
  readonly onToggleDock: () => void;
  /** Controls floated at the bottom centre of the sheet. */
  readonly actions?: ReactNode;
  /** The attempt the inspector shows right now, marked in the tray. */
  readonly viewing: { readonly frame: number; readonly attempt: number | null } | null;
  /** An attempt chosen in the tray: the inspector shows it. */
  readonly onPickAttempt: (frame: number, attempt: number) => void;
}) {
  const [moved, setMoved] = useState<Record<number, XY>>({});
  const [restored, setRestored] = useState(false);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);

  // The tray of attempts unfolded beside a card. `trayFrame` is what is mounted, `trayOpen` what is
  // wanted, so closing can play out before the tray leaves the DOM.
  const [trayFrame, setTrayFrame] = useState<number | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const trayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const dragRef = useRef<{ index: number; startX: number; startY: number; grabX: number; grabY: number; pointerX: number; pointerY: number; point: XY } | null>(null);
  const panLive = useRef<XY>({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const userAdjusted = useRef(false);
  const framed = useRef(false);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panLive.current = pan;
  }, [pan]);

  // Read placed cards after mount: localStorage is not available during SSR,
  // and reading it in the initializer would hydrate a different sheet.
  useEffect(() => {
    setMoved(readMoved(run.id));
    setRestored(true);
  }, [run.id]);

  const cols = columnsFor(run.frames.length);
  const positions = useMemo(
    () =>
      run.frames.map((frame, position) =>
        moved[frame.index] ?? {
          x: PAD + (position % cols) * (CARD_W + GAP_X),
          y: PAD + Math.floor(position / cols) * (CARD_H + GAP_Y),
        },
      ),
    [run.frames, moved, cols],
  );
  // The sheet is as big as its cards, wherever they have been placed, a card mid-drag included.
  const bounds = useMemo(() => {
    if (!positions.length) return { minX: 0, minY: 0, width: PAD * 2, height: PAD * 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach((point, index) => {
      const at = drag?.index === index + 1 ? drag : point;
      minX = Math.min(minX, at.x);
      minY = Math.min(minY, at.y);
      maxX = Math.max(maxX, at.x + CARD_W);
      maxY = Math.max(maxY, at.y + CARD_H);
    });
    return { minX: minX - PAD, minY: minY - PAD, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 };
  }, [positions, drag]);

  /** The sheet pans freely; only a strip of it has to stay on screen so it can't be lost. */
  const clampPan = useCallback(
    (next: XY, z: number): XY => {
      const axis = (value: number, start: number, content: number, view: number) => {
        const size = content * z;
        const margin = Math.min(PAN_MARGIN, size, view);
        // Screen position of the sheet's near edge is pan + start*z; keep `margin` px of it inside the view.
        return clamp(value, margin - start * z - size, view - margin - start * z);
      };
      return {
        x: axis(next.x, bounds.minX, bounds.width, viewSize.w),
        y: axis(next.y, bounds.minY, bounds.height, viewSize.h),
      };
    },
    [bounds.minX, bounds.minY, bounds.width, bounds.height, viewSize.w, viewSize.h],
  );

  /** The zoom and pan that show the whole sheet between the toolbar and the drawing controls. */
  const fitted = useCallback(() => {
    const height = Math.max(1, viewSize.h - FIT_TOP - FIT_BOTTOM);
    const fit = Math.min(viewSize.w / bounds.width, height / bounds.height) * 0.94;
    const z = clamp(fit, MIN_ZOOM, FIT_MAX);
    return {
      fit,
      zoom: z,
      pan: { x: (viewSize.w - bounds.width * z) / 2 - bounds.minX * z, y: FIT_TOP + (height - bounds.height * z) / 2 - bounds.minY * z },
    };
  }, [bounds.minX, bounds.minY, bounds.width, bounds.height, viewSize.w, viewSize.h]);

  const fitView = useCallback(() => {
    if (!viewSize.w || !viewSize.h) return;
    const next = fitted();
    userAdjusted.current = true;
    setZoom(next.zoom);
    setPan(next.pan);
  }, [fitted, viewSize.w, viewSize.h]);

  const centreOn = useCallback(
    (point: XY, z: number) => {
      if (!viewSize.w || !viewSize.h) return;
      userAdjusted.current = true;
      setPan(clampPan({ x: viewSize.w / 2 - (point.x + CARD_W / 2) * z, y: viewSize.h / 2 - (point.y + CARD_H / 2) * z }, z));
    },
    [clampPan, viewSize.w, viewSize.h],
  );

  const centreFrame = useCallback(
    (index: number, z = zoom) => {
      const point = positions[index - 1];
      if (point) centreOn(point, z);
    },
    [positions, zoom, centreOn],
  );

  /** Bring a frame into view only when it is off the edge, so arrows don't jump the canvas. */
  const reveal = useCallback(
    (index: number) => {
      const point = positions[index - 1];
      if (!point || !viewSize.w) return;
      const x = point.x * zoom + pan.x;
      const y = point.y * zoom + pan.y;
      const right = x + CARD_W * zoom;
      const bottom = y + CARD_H * zoom;
      if (x < 32 || y < 32 || right > viewSize.w - 32 || bottom > viewSize.h - 32) centreFrame(index);
    },
    [positions, viewSize.w, viewSize.h, zoom, pan.x, pan.y, centreFrame],
  );

  const zoomTo = (next: number) => {
    if (!viewSize.w) return;
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const cx = viewSize.w / 2;
    const cy = viewSize.h / 2;
    userAdjusted.current = true;
    setPan((current) => clampPan({ x: cx - ((cx - current.x) / zoom) * z, y: cy - ((cy - current.y) / zoom) * z }, z));
    setZoom(z);
  };

  // Measure the viewport; the minimap and fit both need its real size.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewSize({ w: viewport.clientWidth, h: viewport.clientHeight }));
    setViewSize({ w: viewport.clientWidth, h: viewport.clientHeight });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Frame the sheet until the person takes over the view. A run that fits readably opens whole; a long one opens on
  // the current frame. The view is measured more than once while the page settles (alerts, the dock's width), so it
  // is framed again each time instead of once.
  const framing = useRef({ positions, selected });
  framing.current = { positions, selected };
  useEffect(() => {
    if (!restored || userAdjusted.current || !viewSize.w || !viewSize.h || !framing.current.positions.length) return;
    framed.current = true;
    const next = fitted();
    if (next.fit >= FIT_READABLE) {
      setZoom(next.zoom);
      setPan(next.pan);
      return;
    }
    const { positions: all, selected: current } = framing.current;
    const point = all[Math.max(0, (current ?? 1) - 1)] ?? all[0];
    setZoom(INITIAL_ZOOM);
    setPan({ x: viewSize.w / 2 - (point.x + CARD_W / 2) * INITIAL_ZOOM, y: viewSize.h / 2 - (point.y + CARD_H / 2) * INITIAL_ZOOM });
  }, [restored, viewSize.w, viewSize.h, fitted, positions.length]);

  // Wheel has to be native and non-passive, or preventDefault is ignored.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      // On a narrow screen the workspace sits inside a scrolling page; a bare
      // wheel belongs to the page there. ⌘/ctrl still zooms.
      if (!event.ctrlKey && !event.metaKey && window.matchMedia("(max-width: 1080px)").matches) return;
      event.preventDefault();
      userAdjusted.current = true;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const z = zoomRef.current;
        const next = clamp(z - event.deltaY * 0.0015 * z, MIN_ZOOM, MAX_ZOOM);
        setPan((current) => ({ x: px - ((px - current.x) / z) * next, y: py - ((py - current.y) / z) * next }));
        setZoom(next);
        return;
      }
      setPan((current) =>
        clampPan(
          {
            x: current.x - (event.shiftKey ? event.deltaY : event.deltaX),
            y: current.y - (event.shiftKey ? 0 : event.deltaY),
          },
          zoomRef.current,
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [clampPan]);

  // ── Panning ────────────────────────────────────────────────────────
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    movedRef.current = false;
    panRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    const dx = event.clientX - panRef.current.startX;
    const dy = event.clientY - panRef.current.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      movedRef.current = true;
      userAdjusted.current = true;
      setPanning(true);
    }
    setPan(clampPan({ x: panRef.current.panX + dx, y: panRef.current.panY + dy }, zoomRef.current));
  };
  const handlePointerUp = () => {
    // A press on the bare sheet that never turned into a pan puts the tray away.
    if (panRef.current && !movedRef.current) closeTray();
    panRef.current = null;
    setPanning(false);
  };

  // ── Frame cards ────────────────────────────────────────────────────
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, frame: RotoscopeFrame) => {
    if (event.button !== 0) return;
    // Space is the pan tool: let the press fall through to the canvas.
    if (spaceHeld) return;
    event.stopPropagation();
    const point = positions[frame.index - 1];
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!point || !rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    movedRef.current = false;
    // Where inside the card the pointer took hold, in sheet units, so the card stays under it while the sheet scrolls.
    const grabX = (event.clientX - rect.left - panLive.current.x) / zoomRef.current - point.x;
    const grabY = (event.clientY - rect.top - panLive.current.y) / zoomRef.current - point.y;
    dragRef.current = { index: frame.index, startX: event.clientX, startY: event.clientY, grabX, grabY, pointerX: event.clientX, pointerY: event.clientY, point };
    onSelect(frame.index);
  };
  /** Put the dragged card under the pointer, wherever the sheet has scrolled to. */
  const placeDrag = () => {
    const current = dragRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!current || !rect || !movedRef.current) return;
    const z = zoomRef.current;
    current.point = {
      x: (current.pointerX - rect.left - panLive.current.x) / z - current.grabX,
      y: (current.pointerY - rect.top - panLive.current.y) / z - current.grabY,
    };
    setDrag({ index: current.index, x: current.point.x, y: current.point.y });
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current) return;
    event.stopPropagation();
    current.pointerX = event.clientX;
    current.pointerY = event.clientY;
    // A plain click stays a click: the card only lifts once the pointer has really moved.
    if (!movedRef.current && Math.abs(event.clientX - current.startX) <= DRAG_THRESHOLD && Math.abs(event.clientY - current.startY) <= DRAG_THRESHOLD) return;
    movedRef.current = true;
    placeDrag();
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current) return;
    event.stopPropagation();
    dragRef.current = null;
    if (movedRef.current) {
      const next = { ...moved, [current.index]: current.point };
      setMoved(next);
      writeMoved(run.id, next);
      userAdjusted.current = true;
    }
    setDrag(null);
  };

  // Holding a card at the edge of the view scrolls the sheet toward it, so a card can be taken as far as the sheet goes.
  const clampPanRef = useRef(clampPan);
  clampPanRef.current = clampPan;
  const placeDragRef = useRef(placeDrag);
  placeDragRef.current = placeDrag;
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const current = dragRef.current;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (current && rect) {
        const push = (distance: number) => (distance < EDGE_PAN ? (1 - Math.max(distance, 0) / EDGE_PAN) * EDGE_PAN_SPEED : 0);
        const vx = push(current.pointerX - rect.left) - push(rect.right - current.pointerX);
        const vy = push(current.pointerY - rect.top) - push(rect.bottom - current.pointerY);
        if (vx || vy) {
          const next = clampPanRef.current({ x: panLive.current.x + vx, y: panLive.current.y + vy }, zoomRef.current);
          panLive.current = next;
          setPan(next);
          placeDragRef.current();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const cardPoint = (index: number): XY => (drag?.index === index ? { x: drag.x, y: drag.y } : positions[index - 1] ?? { x: 0, y: 0 });

  const openTray = (index: number) => {
    clearTimeout(trayTimer.current);
    setTrayFrame(index);
    setTrayOpen(true);
    // The sheet covers the bottom of the canvas: lift the card clear of it if it sits underneath.
    const point = positions[index - 1];
    if (!point) return;
    const bottom = pan.y + (point.y + CARD_H) * zoom;
    const limit = viewSize.h - TRAY_RESERVE;
    if (bottom > limit) {
      userAdjusted.current = true;
      setPan((current) => clampPan({ x: current.x, y: current.y - (bottom - limit) }, zoom));
    }
  };
  const closeTray = useCallback(() => {
    setTrayOpen(false);
    clearTimeout(trayTimer.current);
    trayTimer.current = setTimeout(() => setTrayFrame(null), 260);
  }, []);
  useEffect(() => () => clearTimeout(trayTimer.current), []);

  // Keyboard moves ask for focus on a card that may still be culled; the effect below
  // lands it once the card exists.
  const focusRequest = useRef<number | null>(null);
  useEffect(() => {
    const index = focusRequest.current;
    if (index === null) return;
    const card = viewportRef.current?.querySelector<HTMLButtonElement>(`[data-frame-index="${index}"]`);
    if (!card) return;
    focusRequest.current = null;
    card.focus({ preventScroll: true });
  });

  const selectByKey = (next: number) => {
    focusRequest.current = next;
    onSelect(next);
    reveal(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === " ") {
      // Space on a card is the button's own activation; on the canvas it is the pan tool.
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (event.key === "Escape" && trayFrame !== null) {
      event.preventDefault();
      closeTray();
      return;
    }
    const current = selected ?? 1;
    const target =
      event.key === "ArrowRight" ? Math.min(run.frames.length, current + 1)
        : event.key === "ArrowLeft" ? Math.max(1, current - 1)
          : event.key === "ArrowDown" ? (current + cols <= run.frames.length ? current + cols : current)
            : event.key === "ArrowUp" ? (current > cols ? current - cols : current)
              : null;
    if (target !== null && target !== current) {
      event.preventDefault();
      selectByKey(target);
      return;
    }
    if (event.key === "Home" && run.frames.length) {
      event.preventDefault();
      selectByKey(1);
      return;
    }
    if (event.key === "End" && run.frames.length) {
      event.preventDefault();
      selectByKey(run.frames.length);
      return;
    }
    if (event.key === "0" || event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitView();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(zoom + 0.15);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomTo(zoom - 0.15);
    }
  };

  const resetLayout = () => {
    setMoved({});
    writeMoved(run.id, {});
  };

  // ── Rendering ──────────────────────────────────────────────────────
  const visible = useMemo(() => {
    if (!viewSize.w || !viewSize.h) return positions.map((_, index) => index);
    const left = -pan.x / zoom - CULL_MARGIN;
    const top = -pan.y / zoom - CULL_MARGIN;
    const right = left + viewSize.w / zoom + CULL_MARGIN * 2;
    const bottom = top + viewSize.h / zoom + CULL_MARGIN * 2;
    return positions.flatMap((point, index) =>
      point.x + CARD_W >= left && point.x <= right && point.y + CARD_H >= top && point.y <= bottom ? [index] : [],
    );
  }, [positions, pan.x, pan.y, zoom, viewSize.w, viewSize.h]);

  // One tab stop for the sheet: the current card, or the sheet itself while that card is scrolled out of view.
  const tabStop = selected ?? 1;
  const tabStopVisible = visible.includes(tabStop - 1);
  // The tray mounts while its frame is chosen, and stays through the closing animation.
  const tray = (() => {
    if (trayFrame === null) return null;
    const frame = run.frames.find((entry) => entry.index === trayFrame);
    if (!frame) return null;
    const items = trayItems(frame, run.live?.frame === frame.index ? run.live : null);
    return items.length ? { frame, items } : null;
  })();
  const detailed = zoom >= DETAIL_ZOOM;
  const view = {
    x: -pan.x / zoom,
    y: -pan.y / zoom,
    w: viewSize.w / zoom,
    h: viewSize.h / zoom,
  };

  return (
    <div className={styles.canvas}>
      <div
        ref={viewportRef}
        role="group"
        aria-label={`Frame sheet, ${run.frames.length} frames`}
        aria-describedby="rotoscope-canvas-help"
        tabIndex={tabStopVisible ? -1 : 0}
        className={cn(styles.viewport, drag || panning ? styles.grabbing : spaceHeld ? styles.grab : undefined)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (event.key === " ") setSpaceHeld(false);
        }}
        onBlur={() => setSpaceHeld(false)}
      >
        <div
          className={styles.dots}
          style={{
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
          }}
          aria-hidden
        />
        {run.frames.length ? (
          <div
            className={styles.world}
            style={{
              width: bounds.minX + bounds.width,
              height: bounds.minY + bounds.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {visible.map((position) => {
              const frame = run.frames[position];
              if (!frame) return null;
              const state = frameState(run, frame);
              const live = state === "drawing" ? run.live : null;
              const point = cardPoint(frame.index);
              const isDragging = drag?.index === frame.index;
              return (
                <button
                  key={frame.index}
                  type="button"
                  data-frame-index={frame.index}
                  data-selected={frame.index === selected}
                  data-expanded={trayOpen && trayFrame === frame.index}
                  data-state={state}
                  data-lod={detailed ? "detail" : "block"}
                  data-dragging={isDragging}
                  className={styles.card}
                  style={{ left: point.x, top: point.y, width: CARD_W, height: CARD_H }}
                  tabIndex={frame.index === tabStop ? 0 : -1}
                  aria-pressed={frame.index === selected}
                  aria-expanded={trayOpen && trayFrame === frame.index}
                  aria-label={`Frame ${frame.index}, ${STATE_LABEL[state]}${frame.manual ? ", approved by you" : ""}`}
                  title={`Frame ${frame.index} · ${time(run, frame.index)} · ${STATE_LABEL[state]}`}
                  onPointerDown={(event) => startDrag(event, frame)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(event) => {
                    if (movedRef.current) {
                      event.preventDefault();
                      return;
                    }
                    onSelect(frame.index);
                    if (trayOpen && trayFrame === frame.index) closeTray();
                    else openTray(frame.index);
                  }}
                >
                  <span className={styles.thumb} data-transparent="">
                    {detailed ? (
                      frame.status === "approved" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- approved drawing from the run's media route
                        <img src={`${rotoscopeUrls.media(run.id, "frame", frame.index)}&v=${frame.approvedAttempt}`} alt="" draggable={false} loading="lazy" decoding="async" />
                      ) : live?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the attempt being checked
                        <img src={rotoscopeUrls.media(run.id, "attempt", frame.index, live.attempt)} alt="" draggable={false} className={styles.checking} />
                      ) : live ? (
                        <Skeleton className={styles.working} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- the video frame, dimmed until drawn
                        <img src={rotoscopeUrls.media(run.id, "source", frame.index)} alt="" draggable={false} loading="lazy" decoding="async" className={styles.ghost} />
                      )
                    ) : (
                      <span className={styles.block} aria-hidden />
                    )}
                    {state === "drawing" && live ? <span className={styles.liveFlag}>Attempt {live.tries}</span> : null}
                    <span className={styles.frameIndex} aria-hidden>{frame.index}</span>
                    <span className={styles.status} data-state={state} aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty} role="status" aria-label="Cutting the clip into frames">
            {/* The sheet that is about to appear, as empty cards: the canvas looks like itself while it waits. */}
            <div className={styles.ghosts} aria-hidden>
              {Array.from({ length: 8 }, (_, position) => <Skeleton key={position} delay={position * 110} />)}
            </div>
            <p><Spinner className="size-3" />Cutting the clip into frames…</p>
          </div>
        )}
      </div>

      <p id="rotoscope-canvas-help" className="sr-only">Arrow keys move between frames. Home and End jump to the first and last. Plus and minus zoom, F fits every frame, hold Space and drag to pan.</p>
      <p className={styles.hint} aria-hidden>Drag to pan · ⌘ scroll to zoom · drag a frame to place it</p>

      {/* Nothing to map until the clip has been cut into frames. */}
      {run.frames.length ? (
        <div className={styles.minimapWrap}>
          <CanvasMinimap
            nodes={positions.map((point, index) => ({ id: String(index + 1), ...point }))}
            bounds={bounds}
            view={view}
            selected={selected}
            onJump={(point) => centreOn(point, zoom)}
            label="Overview of the frame sheet"
          />
        </div>
      ) : null}

      {tray ? (
        <AttemptTray
          key={tray.frame.index}
          run={run}
          frame={tray.frame}
          items={tray.items}
          current={viewing?.frame === tray.frame.index ? viewing.attempt : null}
          open={trayOpen}
          onPick={(attempt) => onPickAttempt(tray.frame.index, attempt)}
          onClose={() => {
            closeTray();
            viewportRef.current?.querySelector<HTMLButtonElement>(`[data-frame-index="${tray.frame.index}"]`)?.focus({ preventScroll: true });
          }}
        />
      ) : null}

      {actions ? <div className={styles.actionBar} role="group" aria-label="Drawing">{actions}</div> : null}

      <div className={styles.toolbar} role="toolbar" aria-label="Canvas view">
        <CanvasTool icon={ZoomOutIcon} label="Zoom out" onClick={() => zoomTo(zoom - 0.15)} />
        <button type="button" className={styles.zoomValue} onClick={() => zoomTo(1)} aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to 100 percent`}>
          {Math.round(zoom * 100)}%
        </button>
        <CanvasTool icon={ZoomInIcon} label="Zoom in" onClick={() => zoomTo(zoom + 0.15)} />
        <span className={styles.divider} aria-hidden />
        <CanvasTool icon={CenterFocusIcon} label="Centre the selected frame" onClick={() => centreFrame(selected ?? 1)} disabled={!run.frames.length} />
        <CanvasTool icon={ArrowExpand01Icon} label="Fit every frame" onClick={fitView} disabled={!run.frames.length} />
        <CanvasTool icon={GridViewIcon} label="Put the frames back in order" onClick={resetLayout} disabled={!Object.keys(moved).length} />
        {/* The inspector closes from its own header; the toolbar only offers to bring it back. */}
        {dockOpen ? null : (
          <>
            <span className={styles.divider} aria-hidden />
            <CanvasTool icon={PanelRightOpenIcon} label="Show inspector" onClick={onToggleDock} />
          </>
        )}
      </div>
    </div>
  );
}

function CanvasTool({
  icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  readonly icon: typeof ZoomInIcon;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled} className={styles.tool}>
          <HugeiconsIcon icon={icon} size={15} strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function CanvasMinimap({
  nodes,
  bounds,
  view,
  selected,
  onJump,
  label,
}: {
  readonly nodes: ReadonlyArray<{ readonly id: string } & XY>;
  readonly bounds: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number };
  readonly view: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly selected: number | null;
  readonly onJump: (point: XY) => void;
  readonly label: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const inner = { w: MINIMAP_W - MINIMAP_PAD * 2, h: MINIMAP_H - MINIMAP_PAD * 2 };
  const k = Math.min(inner.w / Math.max(bounds.width, 1), inner.h / Math.max(bounds.height, 1));
  const ox = MINIMAP_PAD + (inner.w - bounds.width * k) / 2;
  const oy = MINIMAP_PAD + (inner.h - bounds.height * k) / 2;
  const px = (x: number) => ox + (x - bounds.minX) * k;
  const py = (y: number) => oy + (y - bounds.minY) * k;

  const jump = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localX = ((clientX - rect.left) / rect.width) * MINIMAP_W;
    const localY = ((clientY - rect.top) / rect.height) * MINIMAP_H;
    onJump({ x: bounds.minX + (localX - ox) / k, y: bounds.minY + (localY - oy) / k });
  };

  return (
    <div className={styles.minimap}>
      <svg
        ref={svgRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`}
        aria-hidden
        data-label={label}
        className={styles.minimapSvg}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          jump(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging.current) jump(event.clientX, event.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {nodes.map((node) => (
          <rect
            key={node.id}
            x={px(node.x)}
            y={py(node.y)}
            width={Math.max(1.5, CARD_W * k)}
            height={Math.max(1.5, CARD_H * k)}
            rx={1}
            fill={Number(node.id) === selected ? "var(--primary)" : "var(--muted-foreground)"}
            opacity={Number(node.id) === selected ? 0.95 : 0.3}
          />
        ))}
        <rect
          x={px(view.x)}
          y={py(view.y)}
          width={Math.max(4, view.w * k)}
          height={Math.max(4, view.h * k)}
          rx={2}
          fill="var(--primary)"
          fillOpacity={0.06}
          stroke="var(--primary)"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
