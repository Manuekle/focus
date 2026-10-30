"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import shell from "../editor/studio.module.css";

export const SIDEBAR_DEFAULT = 248;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
/** Dragging this far under the minimum folds the sidebar away. */
const COLLAPSE_BELOW = SIDEBAR_MIN - 60;
const WIDTH_KEY = "focus.sidebar.width";
const COLLAPSED_KEY = "focus.sidebar.collapsed";
const STEP = 16;
/** Below this the sidebar is a drawer over the page instead of a column beside it (studio.module.css). */
const NARROW = "(max-width: 860px)";
const subscribeNarrow = (notify: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

const clamp = (value: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));

/**
 * The studio sidebar: its width, dragged or keyed by the person, and whether
 * it is folded away. Remembered in this browser and shared by both studio
 * pages. Storage is a convenience only: every read and write may fail.
 *
 * On a narrow screen the sidebar is a drawer, closed until asked for; that choice is
 * the visit's own and never stored, so the column's saved state stays what it was on desktop.
 */
export function useSidebar() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = narrow && drawerOpen;

  // Back on a wide screen the drawer is forgotten; Escape puts it away on a narrow one.
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) setWidth(clamp(saved));
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Private window or blocked storage: the defaults stand.
    }
  }, []);

  const remember = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Not remembered; still applied.
    }
  };
  const commitWidth = useCallback((next: number) => {
    const value = clamp(next);
    setWidth(value);
    setCollapsed(false);
    remember(WIDTH_KEY, String(value));
    remember(COLLAPSED_KEY, "0");
  }, []);
  const commitCollapsed = useCallback((next: boolean) => {
    if (narrow) {
      setDrawerOpen(!next);
      return;
    }
    setCollapsed(next);
    remember(COLLAPSED_KEY, next ? "1" : "0");
  }, [narrow]);

  /** A tap on the dimmed page, or on something in the drawer, puts the drawer away. */
  const onBodyClick = (event: MouseEvent<HTMLElement>) => {
    if (!drawer) return;
    const target = event.target as HTMLElement;
    if (target === event.currentTarget || target.closest("aside a, aside button")) setDrawerOpen(false);
  };

  return {
    width,
    collapsed: narrow ? !drawerOpen : collapsed,
    dragging,
    setDragging,
    previewWidth: (next: number) => setWidth(clamp(next)),
    previewCollapsed: setCollapsed,
    commitWidth,
    commitCollapsed,
    /** Spread on the studio body: the grid column reads the width from here. */
    bodyProps: {
      style: { "--sidebar-width": collapsed ? "0px" : `${width}px` } as CSSProperties,
      "data-collapsed": (!narrow && collapsed) || undefined,
      "data-drawer": drawer || undefined,
      onClick: onBodyClick,
    },
  };
}

type Sidebar = ReturnType<typeof useSidebar>;

/**
 * Header button to collapse or expand the studio sidebar, placed beside the app logo.
 */
export function SidebarToggle({
  sidebar,
  ariaControls,
  className,
}: {
  readonly sidebar: Sidebar;
  readonly ariaControls?: string;
  readonly className?: string;
}) {
  const { collapsed, commitCollapsed } = sidebar;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(shell.sidebarToggle, className)}
      aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
      aria-expanded={!collapsed}
      aria-controls={ariaControls}
      data-static
      onClick={() => commitCollapsed(!collapsed)}
    >
      <HugeiconsIcon
        icon={collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon}
        size={18}
        strokeWidth={1.75}
      />
    </Button>
  );
}

/**
 * The edge between the sidebar and the page: drag it to resize (far enough
 * folds the sidebar), arrow keys resize it, double click resets.
 */
export function SidebarResizer({ sidebar }: { readonly sidebar: Sidebar; readonly showToggle?: boolean }) {
  const { width, collapsed, dragging, setDragging, previewWidth, previewCollapsed, commitWidth, commitCollapsed } = sidebar;
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const raw = start.current.width + event.clientX - start.current.x;
    previewCollapsed(raw < COLLAPSE_BELOW);
    if (raw >= COLLAPSE_BELOW) previewWidth(raw);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const raw = start.current.width + event.clientX - start.current.x;
    if (raw < COLLAPSE_BELOW) commitCollapsed(true);
    else commitWidth(raw);
    start.current = null;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "ArrowLeft" ? width - STEP : event.key === "ArrowRight" ? width + STEP : event.key === "Home" ? SIDEBAR_MIN : event.key === "End" ? SIDEBAR_MAX : null;
    if (next === null) return;
    event.preventDefault();
    commitWidth(next);
  };

  return collapsed ? null : (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className={shell.resizer}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT)}
    />
  );
}
