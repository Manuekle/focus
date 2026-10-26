"use client";

import { type ComponentProps, type ReactNode, type RefObject, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { Popover } from "radix-ui";
import { cn } from "@/lib/utils";
import { EASE_SMOOTH_OUT } from "@/lib/ease";

const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function firstTabbable(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return root.matches(TABBABLE) ? root : root.querySelector<HTMLElement>(TABBABLE);
}

function AnimatedPanel({
  children,
  ...props
}: ComponentProps<typeof motion.div>) {
  const isPresent = useIsPresent();

  return (
    <motion.div {...props} inert={!isPresent} aria-hidden={!isPresent || undefined}>
      {children}
    </motion.div>
  );
}

/** Keep positioning separate from motion, and retain the panel until exit finishes. */
export function ChatDropdown({
  open,
  onClose,
  anchorRef,
  side,
  label,
  className,
  retainFocus = false,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly side: "top" | "bottom";
  readonly label: string;
  readonly className?: string;
  /**
   * Leave keyboard focus where it is — the composer, for a list driven by
   * typing and arrow keys. By default focus moves to the first action on
   * open and back to whatever opened the panel when it is dismissed.
   */
  readonly retainFocus?: boolean;
  readonly children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const virtualAnchor = useMemo(() => ({
    current: {
      getBoundingClientRect: () => anchorRef.current?.getBoundingClientRect() ?? new DOMRect(),
      get contextElement() { return anchorRef.current ?? undefined; },
    },
  }), [anchorRef]);
  const closed = { opacity: 0, transform: reducedMotion ? "none" : "scale(0.97)" };

  // Radix only autofocuses when the content mounts, and a reopen during the
  // exit reuses the mounted panel — so focus is moved here for both cases.
  useEffect(() => {
    const panel = panelRef.current;
    if (retainFocus || !panel) return;
    const active = document.activeElement;
    if (open) {
      if (panel.contains(active)) return;
      returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : firstTabbable(anchorRef.current);
      firstTabbable(panel)?.focus({ preventScroll: true });
      return;
    }
    // A choice moves focus on purpose (back to the composer). A dismissal —
    // Escape, a click elsewhere — leaves it in the leaving, inert panel:
    // return it to the opener before the browser drops it to <body>.
    if (!active || active === document.body || panel.contains(active)) {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
  }, [open, retainFocus, anchorRef]);

  return (
    <Popover.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Popover.Anchor virtualRef={virtualAnchor} />
      <Popover.Portal forceMount>
        <AnimatePresence>
          {open && (
            <Popover.Content
              key="panel"
              forceMount
              asChild
              side={side}
              align="start"
              sideOffset={8}
              collisionPadding={12}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
              }}
            >
              <AnimatedPanel
                ref={panelRef}
                data-slot="chat-dropdown"
                aria-label={label}
                initial={closed}
                animate={{ opacity: 1, transform: reducedMotion ? "none" : "scale(1)" }}
                exit={{
                  ...closed,
                  transform: reducedMotion ? "none" : "scale(0.99)",
                  transition: { duration: reducedMotion ? 0 : 0.15, ease: EASE_SMOOTH_OUT },
                }}
                transition={{ duration: reducedMotion ? 0 : 0.25, ease: EASE_SMOOTH_OUT }}
                className={cn(
                  "z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-popover text-popover-foreground shadow-[var(--shadow-float)] outline-none",
                  className,
                )}
                style={{
                  maxHeight: "var(--radix-popover-content-available-height)",
                  maxWidth: "var(--radix-popover-content-available-width)",
                  transformOrigin: "var(--radix-popover-content-transform-origin)",
                }}
              >
                {children}
              </AnimatedPanel>
            </Popover.Content>
          )}
        </AnimatePresence>
      </Popover.Portal>
    </Popover.Root>
  );
}
