"use client";

import { Csv01Icon, File02Icon, Pdf01Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon, type IconSvgElement } from "../icons/icon";

import {
  AnimatePresence,
  motion,
} from "motion/react";
import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_SWAP } from "../../lib/ease";
import { cn } from "../../lib/utils";

// ── Types ───────────────────────────────────────────────────────────

export type DownloadFileType = "csv" | "pdf" | "default";

export type DownloadAnimationClassNames = {
  root?: string;
  particle?: string;
};

export interface DownloadAnimationProps {
  /** Trigger element — usually a button. */
  children: ReactNode;
  /** The file type icon to show during animation. */
  fileType?: DownloadFileType;
  /** Called when the animation starts (your actual download logic). */
  onDownload: () => void;
  /** Disabled state. */
  disabled?: boolean;
  className?: string;
  classNames?: DownloadAnimationClassNames;
}

// ── Config ──────────────────────────────────────────────────────────

const FILE_ICON: Record<DownloadFileType, IconSvgElement> = {
  csv: Csv01Icon,
  pdf: Pdf01Icon,
  default: File02Icon,
};

const FLIGHT_TRANSITION = {
  duration: 1.5,
  ease: EASE_OUT,
} as const;

const TRAIL_TRANSITION = {
  ...SPRING_SWAP,
  duration: 0.8,
};

// ── Component ───────────────────────────────────────────────────────

export function DownloadAnimation({
  children,
  fileType = "default",
  onDownload,
  disabled,
  className,
  classNames,
}: DownloadAnimationProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [particles, setParticles] = useState<
    Array<{ id: number; x: number; y: number }>
  >([]);

  const spawn = useCallback(() => {
    if (disabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDownload();
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) {
      onDownload();
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const id = Date.now();

    // Start at center of the trigger button
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    setParticles((prev) => [...prev, { id, x: startX, y: startY }]);
    onDownload();

    // Remove after animation completes
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== id));
    }, 1800);
  }, [disabled, onDownload]);

  const fileIcon = FILE_ICON[fileType];

  return (
    <>
      <div
        ref={triggerRef}
        onClick={spawn}
        className={cn(
          "inline-flex",
          disabled && "pointer-events-none opacity-50",
          className,
          classNames?.root,
        )}
      >
        {children}
      </div>

      {/* Escape transformed/scrolling panels; these coordinates are viewport-relative.
          Native trigger buttons already dispatch clicks for Enter and Space. */}
      {particles.length > 0 ? createPortal(<AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            initial={{
              position: "fixed",
              left: particle.x,
              top: particle.y,
              x: "-50%",
              y: "-50%",
              scale: 1,
              opacity: 1,
              zIndex: 9999,
              pointerEvents: "none" as const,
            }}
            animate={{
              // Fly to top-right corner (browser download tray area)
              left: "calc(100vw - 48px)",
              top: "24px",
              scale: 0.5,
              opacity: 0,
            }}
            exit={{ opacity: 0 }}
            transition={FLIGHT_TRANSITION}
            className={cn(
              "fixed z-[9999] text-muted-foreground",
              classNames?.particle,
            )}
          >
            <HugeiconsIcon icon={fileIcon} size={32} strokeWidth={1.5} className="h-8 w-8 drop-shadow-md" />

            {/* Motion trail */}
            <motion.div
              initial={{ opacity: 0.6, scaleX: 1 }}
              animate={{ opacity: 0, scaleX: 0.3 }}
              transition={TRAIL_TRANSITION}
              className="absolute left-1/2 top-1/2 h-1 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/30 blur-[2px]"
            />
          </motion.div>
        ))}
      </AnimatePresence>, document.body) : null}
    </>
  );
}
