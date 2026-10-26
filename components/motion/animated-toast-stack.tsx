"use client";
// beui.dev/components/motion/animated-toast-stack

import * as motion from "motion/react-m";
import {
  Cancel01Icon,
  Loading03Icon,
  Notification01Icon,
} from "@hugeicons/core-free-icons";
import {
  AnimatePresence,
  type Transition,
} from "motion/react";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "../icons/icon";
import { AlertGlyph, AlertIconChip, type AlertTone } from "../ui/alert";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

export type ToastStatus = "neutral" | "info" | "loading" | "success" | "warning" | "error";
export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type AnimatedToastAction = {
  label: ReactNode;
  onClick: (toast: AnimatedToast) => void;
};

export type AnimatedToast = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ToastStatus;
  icon?: ReactNode;
  action?: AnimatedToastAction;
  duration?: number;
  dismissible?: boolean;
  createdAt?: number;
};

export type ToastInput = Omit<AnimatedToast, "id" | "createdAt"> & {
  id?: string;
};

export type ToastClassNames = {
  root?: string;
  item?: string;
  surface?: string;
  iconWrap?: string;
  content?: string;
  title?: string;
  description?: string;
  action?: string;
  close?: string;
  progress?: string;
};

export interface AnimatedToastStackProps {
  toasts: AnimatedToast[];
  onDismiss?: (id: string) => void;
  position?: ToastPosition;
  placement?: "static" | "fixed" | "absolute";
  fixed?: boolean;
  portal?: boolean;
  portalRoot?: Element | null;
  maxVisible?: number;
  className?: string;
  classNames?: ToastClassNames;
  icons?: Partial<Record<ToastStatus, ReactNode>>;
  renderToast?: (toast: AnimatedToast) => ReactNode;
  /** Accessible name of each toast's close button. */
  dismissLabel?: string;
}

export interface UseAnimatedToastStackOptions {
  initialToasts?: ToastInput[];
  defaultDuration?: number;
  limit?: number;
}

const STACK_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
};

/** Reduced motion: a short fade carries the change. The items also drop
 *  `layout` then, so the stack re-flows in place when a toast arrives or
 *  leaves instead of gliding every neighbour into its new slot — the travel
 *  the setting asks to drop. (A zero-duration layout transition still holds
 *  the old position for one frame before jumping.) */
const REDUCED_TRANSITION: Transition = {
  duration: 0.2,
  ease: EASE_OUT,
};

const CONTENT_TRANSITION = {
  duration: 0.28,
  ease: EASE_OUT,
} as const;

// The four outcome statuses share the inline `Alert`'s tones, so a toast and
// the notice it sometimes replaces look like the same thing. `neutral` and
// `loading` are not outcomes: plain card, no wash.
const STATUS_TONE: Record<ToastStatus, AlertTone | undefined> = {
  neutral: undefined,
  loading: undefined,
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

const POSITION_CLASS: Record<ToastPosition, string> = {
  "top-left": "left-4 top-4",
  "top-center": "left-1/2 top-4 -translate-x-1/2",
  "top-right": "right-4 top-4",
  "bottom-left": "bottom-6 left-4",
  "bottom-center": "bottom-6 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-6 right-4",
};

let idSeed = 0;

function createToast(input: ToastInput, defaultDuration: number): AnimatedToast {
  return {
    duration: defaultDuration,
    dismissible: true,
    ...input,
    id: input.id ?? `toast-${Date.now()}-${idSeed++}`,
    createdAt: Date.now(),
  };
}

export function useAnimatedToastStack({
  initialToasts = [],
  defaultDuration = 4200,
  limit,
}: UseAnimatedToastStackOptions = {}) {
  const toastTimers = useRef<Map<string, { timer: number; signature: string }>>(new Map());
  const [toasts, setToasts] = useState<AnimatedToast[]>(() =>
    initialToasts.map((toast) => createToast(toast, defaultDuration)),
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (input: ToastInput) => {
      const toast = createToast(input, defaultDuration);
      setToasts((current) => {
        const next = [...current, toast];
        return typeof limit === "number" ? next.slice(-limit) : next;
      });
      return toast.id;
    },
    [defaultDuration, limit],
  );

  const updateToast = useCallback((id: string, patch: Partial<ToastInput>) => {
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id
          ? {
              ...toast,
              ...patch,
              id,
              createdAt: patch.duration === undefined ? toast.createdAt : Date.now(),
            }
          : toast,
      ),
    );
  }, []);

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));

    toastTimers.current.forEach((entry, id) => {
      if (!activeIds.has(id)) {
        window.clearTimeout(entry.timer);
        toastTimers.current.delete(id);
      }
    });

    toasts.forEach((toast) => {
      const duration = toast.duration ?? defaultDuration;
      const existing = toastTimers.current.get(toast.id);

      if (duration <= 0) {
        if (existing) {
          window.clearTimeout(existing.timer);
          toastTimers.current.delete(toast.id);
        }
        return;
      }

      const createdAt = toast.createdAt ?? Date.now();
      const signature = `${createdAt}:${duration}`;

      if (existing?.signature === signature) {
        return;
      }

      if (existing) {
        window.clearTimeout(existing.timer);
      }

      const elapsed = Date.now() - createdAt;
      const remaining = Math.max(duration - elapsed, 0);
      const timer = window.setTimeout(() => {
        toastTimers.current.delete(toast.id);
        dismissToast(toast.id);
      }, remaining);

      toastTimers.current.set(toast.id, { timer, signature });
    });
  }, [defaultDuration, dismissToast, toasts]);

  useEffect(() => {
    const timers = toastTimers.current;

    return () => {
      timers.forEach((entry) => {
        window.clearTimeout(entry.timer);
      });
      timers.clear();
    };
  }, []);

  return useMemo(
    () => ({
      toasts,
      showToast,
      updateToast,
      dismissToast,
      clearToasts,
      setToasts,
    }),
    [clearToasts, dismissToast, showToast, toasts, updateToast],
  );
}

/** Nothing to subscribe to: the snapshot only ever flips once, on hydration. */
const noSubscribe = () => () => {};

export function AnimatedToastStack({
  toasts,
  onDismiss,
  position = "bottom-right",
  placement,
  fixed = false,
  portal,
  portalRoot,
  maxVisible = 4,
  className,
  classNames,
  icons,
  renderToast,
  dismissLabel = "Dismiss",
}: AnimatedToastStackProps) {
  const visibleToasts = toasts.slice(-maxVisible);
  const isBottom = position.startsWith("bottom");
  const resolvedPlacement = placement ?? (fixed ? "fixed" : "static");
  const shouldPortal = portal ?? resolvedPlacement === "fixed";

  // `document.body` only exists on the client. Read during render once
  // hydrated, rather than copied into state by an effect — the server
  // snapshot keeps the first client render matching the server's.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const portalTarget = hydrated && shouldPortal ? (portalRoot ?? document.body) : null;

  const stack = (
    <ol
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none flex w-[calc(100vw-2rem)] max-w-sm gap-2",
        isBottom ? "flex-col-reverse" : "flex-col",
        resolvedPlacement === "fixed" && "fixed z-[90]",
        resolvedPlacement === "absolute" && "absolute z-20",
        resolvedPlacement !== "static" && POSITION_CLASS[position],
        classNames?.root,
        className,
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {visibleToasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            index={index}
            onDismiss={onDismiss}
            classNames={classNames}
            icons={icons}
            renderToast={renderToast}
            dismissLabel={dismissLabel}
          />
        ))}
      </AnimatePresence>
    </ol>
  );

  if (shouldPortal && !portalTarget) {
    return null;
  }

  if (shouldPortal && portalTarget) {
    return createPortal(stack, portalTarget);
  }

  return stack;
}

const ToastItem = memo(function ToastItem({
  toast,
  index,
  onDismiss,
  classNames,
  icons,
  renderToast,
  dismissLabel,
}: {
  toast: AnimatedToast;
  index: number;
  onDismiss?: (id: string) => void;
  classNames?: ToastClassNames;
  icons?: Partial<Record<ToastStatus, ReactNode>>;
  renderToast?: (toast: AnimatedToast) => ReactNode;
  dismissLabel: string;
}) {
  const reduce = useReducedMotion();
  const status = toast.status ?? "neutral";
  const tone = STATUS_TONE[status];
  // A caller's own icon wins; otherwise the toned statuses get the filled
  // glyph (`AlertIconChip` draws it) and the other two a muted line icon.
  const customIcon = icons?.[status] ?? toast.icon;
  const iconNode =
    customIcon ??
    (status === "loading" ? (
      <HugeiconsIcon icon={Loading03Icon} size={16} strokeWidth={1.75} />
    ) : status === "neutral" ? (
      <HugeiconsIcon icon={Notification01Icon} size={16} strokeWidth={1.75} />
    ) : null);
  const canDismiss = toast.dismissible !== false && Boolean(onDismiss);

  return (
    <motion.li
      layout={!reduce}
      initial={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, y: 22, scale: 0.97, filter: "blur(10px)" }
      }
      animate={
        reduce
          ? { opacity: 1 }
          : { opacity: 1, y: 0, scale: 0.97, filter: "blur(0px)" }
      }
      exit={
        reduce
          ? { opacity: 0 }
          : {
              opacity: 0,
              x: 32,
              scale: 0.97,
              filter: "blur(8px)",
              transition: { duration: 0.25, ease: EASE_OUT },
            }
      }
      transition={reduce ? REDUCED_TRANSITION : STACK_SPRING}
      drag={canDismiss && !reduce ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      onDragEnd={(_, info) => {
        if (!canDismiss || !onDismiss) return;
        if (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 520) {
          onDismiss(toast.id);
        }
      }}
      className={cn("pointer-events-auto relative will-change-transform", classNames?.item)}
      style={{ zIndex: 20 - index }}
    >
      <div
        data-tone={tone ?? "neutral"}
        className={cn(
          "alert-surface relative overflow-hidden rounded-2xl border p-4 shadow-[var(--shadow-float),var(--shadow-inset)]",
          classNames?.surface,
        )}
      >
        {renderToast ? (
          renderToast(toast)
        ) : (
          <div className="flex items-start gap-3">
            <motion.span layout={!reduce} className="inline-flex shrink-0">
              <AlertIconChip className={classNames?.iconWrap}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={status}
                    initial={
                      reduce
                        ? { opacity: 0 }
                        : { opacity: 0, y: 8, scale: 0.8, filter: "blur(6px)" }
                    }
                    animate={
                      reduce
                        ? { opacity: 1 }
                        : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
                    }
                    exit={
                      reduce
                        ? { opacity: 0 }
                        : { opacity: 0, y: -8, scale: 0.9, filter: "blur(6px)" }
                    }
                    transition={CONTENT_TRANSITION}
                    className="inline-flex"
                  >
                    {iconNode ? (
                      status === "loading" ? (
                        <span className="inline-flex animate-spin motion-reduce:animate-none">{iconNode}</span>
                      ) : (
                        iconNode
                      )
                    ) : tone ? (
                      <AlertGlyph tone={tone} />
                    ) : null}
                  </motion.span>
                </AnimatePresence>
              </AlertIconChip>
            </motion.span>

            <div className={cn("min-w-0 flex-1", classNames?.content)}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`${toast.id}-${status}-${String(toast.title)}`}
                  initial={
                    reduce
                      ? { opacity: 0 }
                      : { opacity: 0, y: 8, filter: "blur(6px)" }
                  }
                  animate={
                    reduce
                      ? { opacity: 1 }
                      : { opacity: 1, y: 0, filter: "blur(0px)" }
                  }
                  exit={
                    reduce
                      ? { opacity: 0 }
                      : { opacity: 0, y: -8, filter: "blur(6px)" }
                  }
                  transition={CONTENT_TRANSITION}
                >
                  <p
                    className={cn(
                      "line-clamp-2 text-sm font-medium leading-5 text-foreground",
                      classNames?.title,
                    )}
                  >
                    {toast.title}
                  </p>
                  {toast.description ? (
                    <p
                      className={cn(
                        "mt-0.5 line-clamp-3 text-[13px] leading-5 text-muted-foreground",
                        classNames?.description,
                      )}
                    >
                      {toast.description}
                    </p>
                  ) : null}
                </motion.div>
              </AnimatePresence>

              {toast.action ? (
                <button
                  type="button"
                  onClick={() => toast.action?.onClick(toast)}
                  className={cn(
                    "mt-3 inline-flex h-7 items-center rounded-[9px] border border-border bg-background px-3 text-xs font-medium text-foreground shadow-[var(--shadow-button)] transition-colors hover:bg-muted",
                    classNames?.action,
                  )}
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>

            {canDismiss ? (
              <button
                type="button"
                onClick={() => onDismiss?.(toast.id)}
                aria-label={dismissLabel}
                className={cn(
                  "-my-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                  classNames?.close,
                )}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        )}

      </div>
    </motion.li>
  );
});
