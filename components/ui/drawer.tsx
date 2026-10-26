"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { EASE_OUT, SPRING_PANEL } from "../../lib/ease";
import { PresenceGate } from "../../lib/presence-gate";
import { cn } from "../../lib/utils";

import { HugeiconsIcon } from "../icons/icon";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

interface DrawerProps {
  open: boolean;
  /**
   * Escape, the backdrop and the close button all ask here first. The panel
   * only starts its exit once `open` turns false, so a parent that refuses to
   * close (a save in flight) keeps the drawer on screen.
   */
  onOpenChange: (open: boolean) => void;
  panelClassName?: string;
  /** Defaults to the `DrawerTitle` rendered inside the drawer. */
  ariaLabelledBy?: string;
  closeLabel?: string;
  children: React.ReactNode;
}

const DrawerContext = React.createContext<{ onOpenChange: (open: boolean) => void; closeLabel: string; titleId: string } | null>(null);

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter((element) => element.getClientRects().length > 0);
}

/**
 * `aria-modal` alone does not stop Tab, a screen reader's virtual cursor or a
 * stray focus() from reaching the page behind. Mark every other top-level node
 * inert while the drawer is open. Live regions (the toast stack) stay out of
 * it so a save result is still announced and its dismiss button still works;
 * overlays opened from inside the drawer portal in later and are untouched.
 */
function isolateBackground(layers: ReadonlyArray<Element | null>): () => void {
  const isolated: Element[] = [];
  for (const element of Array.from(document.body.children)) {
    if (layers.includes(element) || element.hasAttribute("inert") || element.matches("script, style, link, template, [aria-live]")) continue;
    element.setAttribute("inert", "");
    isolated.push(element);
  }
  return () => {
    for (const element of isolated) element.removeAttribute("inert");
  };
}

function Drawer({ open, onOpenChange, panelClassName, ariaLabelledBy, closeLabel = "Close", children }: DrawerProps) {
  const [mounted, setMounted] = React.useState(false);
  const [wasOpen, setWasOpen] = React.useState(false);
  const [returnFocus, setReturnFocus] = React.useState<HTMLElement | null>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const backdropRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const reduce = useReducedMotion();
  const panelVariants = reduce
    ? {
        closed: { opacity: 0, transition: { duration: 0.35, ease: EASE_OUT } },
        open: { opacity: 1, transition: { duration: 0.4, ease: EASE_OUT } },
      }
    : {
        closed: {
          x: "calc(100% + 4rem)",
          transition: SPRING_PANEL,
        },
        open: { x: 0, transition: SPRING_PANEL },
      };

  if (open !== wasOpen) {
    setWasOpen(open);
    // Read the opener now, before this commit mounts the panel: an `autoFocus`
    // field inside it takes focus during the commit, ahead of any effect.
    if (open && typeof document !== "undefined") {
      const active = document.activeElement;
      setReturnFocus(active instanceof HTMLElement && active !== document.body ? active : null);
    }
  }

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Closing is the parent's decision. Ask first; the exit plays only after
  // `open` turns false, and AnimatePresence keeps drawing the last open
  // content while it does.
  const requestClose = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    if (!panel) return;
    const restoreBackground = isolateBackground([panel, backdropRef.current]);
    // A field with `autoFocus`, or a child effect, may already have placed
    // focus inside; otherwise start at the first control.
    if (!panel.contains(document.activeElement)) (tabbables(panel)[0] ?? panel).focus({ preventScroll: true });
    return () => {
      restoreBackground();
      // Hand focus back only when it would otherwise be lost — still inside
      // the leaving (inert) panel, or already dropped to <body>. A parent that
      // moved it somewhere on purpose keeps it there.
      const active = document.activeElement;
      if (returnFocus?.isConnected && (!active || active === document.body || panel.contains(active))) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [open, mounted, returnFocus]);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      // A dialog opened from inside the drawer handles its own Escape. Only
      // close this drawer while focus is within its panel, or has fallen
      // back to <body> (the background is inert, so nothing else can hold it).
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (panelRef.current?.contains(e.target as Node) || e.target === document.body) requestClose();
    };
    if (open) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [open, requestClose]);

  React.useEffect(() => {
    if (!open) return;
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      const active = document.activeElement;
      // Focus on <body> (its element was removed) is pulled back in too; focus
      // in an overlay opened from the drawer is that overlay's business.
      const lost = !active || active === document.body;
      if (!panel || (!lost && !panel.contains(active))) return;
      const focusable = tabbables(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || lost)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <DrawerContext.Provider value={{ onOpenChange: requestClose, closeLabel, titleId }}>
      <AnimatePresence>
        {open ? (
          <PresenceGate key="backdrop">
            {({ gate }) => (
              <motion.button
                ref={backdropRef}
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={requestClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduce ? { duration: 0.35, ease: EASE_OUT } : { duration: 0.4, ease: EASE_OUT }}
                {...gate}
                className="fixed inset-0 z-50 h-full w-full cursor-default border-0 bg-black/40 p-0 backdrop-blur-sm"
              />
            )}
          </PresenceGate>
        ) : null}
        {open ? (
          <PresenceGate key="panel">
            {({ gate }) => (
              <motion.aside
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy ?? titleId}
                tabIndex={-1}
                initial="closed"
                animate="open"
                exit="closed"
                variants={panelVariants}
                {...gate}
                className={cn(
                  "viewport-drawer fixed inset-y-4 right-4 z-50 flex h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col items-end outline-none sm:inset-y-6 sm:right-6 sm:h-[calc(100%-3rem)] sm:w-[calc(100%-3rem)]",
                  panelClassName,
                )}
              >
                {children}
              </motion.aside>
            )}
          </PresenceGate>
        ) : null}
      </AnimatePresence>
    </DrawerContext.Provider>,
    document.body,
  );
}

function isDrawerFooter(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) return false;
  const props = child.props as Record<string, unknown> | undefined;
  return child.type === DrawerFooter || props?.["data-slot"] === "drawer-footer";
}

function DrawerContent({
  className,
  bodyClassName,
  showCloseButton = true,
  closeClassName,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  bodyClassName?: string;
  showCloseButton?: boolean;
  closeClassName?: string;
}) {
  const ctx = React.useContext(DrawerContext);
  const childArray = React.Children.toArray(children);
  const bodyChildren: React.ReactNode[] = [];
  let footerChild: React.ReactNode = null;

  for (const item of childArray) {
    if (isDrawerFooter(item)) {
      footerChild = item;
    } else {
      bodyChildren.push(item);
    }
  }

  return (
    <div
      data-slot="drawer-content"
      className={cn(
        "relative z-50 ml-auto flex h-full min-h-0 max-h-full w-full max-w-lg flex-col rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]",
        className,
      )}
      {...props}
    >
      <div
        data-slot="drawer-card"
        className={cn(
          "relative flex flex-1 flex-col min-h-0 overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs",
          bodyClassName,
        )}
      >
        {bodyChildren}
        {showCloseButton && (
          <button
            type="button"
            onClick={() => ctx?.onOpenChange(false)}
            aria-label={ctx?.closeLabel ?? "Close"}
            className={cn(
              "absolute top-3.5 right-3.5 z-10 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
              closeClassName,
            )}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
            <span className="sr-only">{ctx?.closeLabel ?? "Close"}</span>
          </button>
        )}
      </div>
      {footerChild && (
        <div data-slot="drawer-footer-wrapper" className="shrink-0 px-2 pt-2 pb-1">
          {footerChild}
        </div>
      )}
    </div>
  );
}

function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex shrink-0 flex-col gap-1.5 border-b border-border/40 p-5 pb-3 text-left", className)}
      {...props}
    />
  );
}

type DrawerTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  icon?: React.ReactNode;
};

function DrawerTitle({
  className,
  icon,
  children,
  id,
  ...props
}: DrawerTitleProps) {
  const ctx = React.useContext(DrawerContext);
  return (
    <h2
      id={id ?? ctx?.titleId}
      data-slot="drawer-title"
      className={cn("flex items-center gap-2.5 text-lg font-medium tracking-[-0.02em] text-foreground leading-normal", className)}
      {...props}
    >
      {icon && (
        <span className="text-foreground/80 shrink-0 inline-flex items-center">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </h2>
  );
}

function DrawerDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="drawer-body"
      className={cn("y-fade min-h-0 min-w-0 flex-1 overflow-y-auto p-5", className)}
      {...props}
    />
  );
}

function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        "flex flex-row items-center justify-between gap-3 w-full [&>*:only-child]:ml-auto",
        className,
      )}
      {...props}
    />
  );
}

export { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerBody, DrawerFooter };
