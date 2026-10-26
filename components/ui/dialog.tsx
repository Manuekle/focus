"use client";

import * as React from "react";
import { HugeiconsIcon } from "../icons/icon";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "../../lib/utils";
import { Button, buttonVariants } from "./button";
import { useSound, type CueName } from "../sound-provider";

/**
 * `open` draws air up as the panel arrives; `close` lets it fall shut when
 * the person dismisses it.
 *
 * The arrival takes both paths below because Radix only calls `onOpenChange`
 * when the *primitive* asks to change — a trigger click, Escape, the scrim. A
 * parent that opens its own dialog with `open={true}` (which is how nearly
 * every dialog in this app opens) never goes through it, so a cue hung on
 * `onOpenChange` alone is silent exactly where it matters most.
 *
 * The exit is the other way round: only the primitive's own dismissal sounds.
 * A dialog that closes because the work landed is closed by its parent, and
 * is already followed by that work's own cue — `success` after a save,
 * `close` after a delete — so cueing here too would stack two sounds inside
 * the same 200ms. Escape and the scrim are what is left; the X and Cancel
 * carry `data-cuelume-close` and sound on their own press, which the
 * `unlessPressedWithin` guard keeps from playing twice.
 */
function useDialogOpenCue(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
  /** What arriving sounds like. Confirms override this with `warning`. */
  sound: CueName = "open",
) {
  const { cue } = useSound();
  const wasOpen = React.useRef(false);

  // A trigger that says `aria-expanded` already played `open` on its own
  // press; the panel arriving under it is the same event.
  const arrival = React.useMemo(
    () => (sound === "open" ? { unlessPressedWithin: 600, unlessPressedAs: "open" as const } : undefined),
    [sound],
  );

  // Controlled: the `open` prop is the only signal there is.
  React.useEffect(() => {
    if (open === undefined) return;
    if (open && !wasOpen.current) cue(sound, arrival);
    wasOpen.current = open;
  }, [open, cue, sound, arrival]);

  return React.useCallback(
    (next: boolean) => {
      // Uncontrolled only — otherwise the effect above would cue this twice.
      if (open === undefined && next) cue(sound, arrival);
      if (!next) cue("close", { emphasis: "subtle", unlessPressedWithin: 400 });
      onOpenChange?.(next);
    },
    [open, cue, sound, arrival, onOpenChange],
  );
}

function Dialog({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const handleOpenChange = useDialogOpenCue(open, onOpenChange);

  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open}
      onOpenChange={handleOpenChange}
      {...props}
    />
  );
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // `.t-scrim` fades via keyframes rather than a transition: Radix keeps
        // a closing element mounted only while an ANIMATION is running.
        "t-scrim fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function isFooterElement(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) return false;
  const props = child.props as Record<string, unknown> | undefined;
  return (
    child.type === DialogFooter ||
    props?.["data-slot"] === "dialog-footer" ||
    props?.["data-slot"] === "alert-dialog-footer"
  );
}

function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      result.push(...flattenChildren((child.props as { children?: React.ReactNode }).children));
    } else if (child !== null && child !== undefined && child !== false) {
      result.push(child);
    }
  });
  return result;
}

function partitionDialogChildren(children: React.ReactNode) {
  const flattened = flattenChildren(children);
  let formElement: React.ReactElement<React.FormHTMLAttributes<HTMLFormElement>> | null = null;
  let footerChild: React.ReactNode = null;
  const bodyChildren: React.ReactNode[] = [];

  for (const item of flattened) {
    if (!React.isValidElement(item)) {
      if (item !== null && item !== undefined && item !== false) {
        bodyChildren.push(item);
      }
      continue;
    }

    if (isFooterElement(item)) {
      footerChild = item;
      continue;
    }

    if (typeof item.type === "string" && item.type === "form") {
      const candidate = item as React.ReactElement<React.FormHTMLAttributes<HTMLFormElement>>;
      const formInner = flattenChildren(candidate.props.children);
      // Only move a form around the frame when its submit footer needs to
      // remain inside it. Inline forms (such as AI template generation) keep
      // their own controls and submit scope inside the card.
      if (!formInner.some(isFooterElement)) {
        bodyChildren.push(item);
        continue;
      }
      formElement = candidate;
      const innerBody: React.ReactNode[] = [];
      for (const inner of formInner) {
        if (isFooterElement(inner)) {
          footerChild = inner;
        } else {
          innerBody.push(inner);
        }
      }
      bodyChildren.push(
        <div key="dialog-form-inner" className={cn("flex flex-col gap-4", formElement.props.className)}>
          {innerBody}
        </div>,
      );
      continue;
    }

    bodyChildren.push(item);
  }

  return { formElement, bodyChildren, footerChild };
}

function DialogContent({
  className,
  bodyClassName,
  children,
  showCloseButton = true,
  closeLabel = "Cerrar",
  closeClassName,
  variant = "default",
  scrollBody = true,
  framed = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  closeLabel?: string;
  closeClassName?: string;
  bodyClassName?: string;
  variant?: "default" | "plain";
  /**
   * All standard dialogs use the muted shell and inset card, with or without
   * a footer. Set false only for a footerless panel that supplies its own
   * chrome; use variant="plain" for a deliberately custom layout.
   */
  framed?: boolean;
  /**
   * Off for a panel whose body holds a popover that is positioned rather than
   * portalled — a calendar hanging off the last field, say. A scroll container
   * clips its own absolutely-positioned children, so such a popover opens
   * behind the card's bottom edge and has to be scrolled into view. Turning
   * this off lets it spill over the panel the way it did before, and the panel
   * then has to be short enough that it never needed to scroll.
   */
  scrollBody?: boolean;
}) {
  if (variant === "plain") {
    return (
      <DialogPortal data-slot="dialog-portal">
        <DialogOverlay />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "t-modal fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-float)] outline-none sm:max-w-lg",
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              data-cuelume-close
              data-cuelume-emphasis="subtle"
              className={cn(
                "absolute top-4 right-4 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                closeClassName,
              )}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.75} />
              <span className="sr-only">{closeLabel}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }

  const { formElement, bodyChildren, footerChild } = partitionDialogChildren(children);

  // An explicit opt-out for a footerless panel that owns its own chrome.
  if (!footerChild && !framed) {
    return (
      <DialogPortal data-slot="dialog-portal">
        <DialogOverlay />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "t-modal fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-float)] outline-none sm:max-w-lg",
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              data-cuelume-close
              data-cuelume-emphasis="subtle"
              className={cn(
                "absolute top-4 right-4 grid size-7 shrink-0 place-items-center rounded-[9px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                closeClassName,
              )}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.75} />
              <span className="sr-only">{closeLabel}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }

  const cardContent = (
    <>
      <div
        data-slot="dialog-card"
        className={cn(
          // The one scroll region. Everything above caps the panel at the
          // viewport; this is what makes the part that no longer fits
          // reachable instead of clipped off the top and bottom edges.
          "relative flex min-h-0 flex-col gap-4 rounded-[14px] border border-border/50 bg-card p-4 shadow-xs sm:p-5",
          scrollBody && "y-fade overflow-x-hidden overflow-y-auto overscroll-contain",
          bodyClassName,
        )}
      >
        {bodyChildren}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            data-cuelume-close
            data-cuelume-emphasis="subtle"
            className={cn(
              "absolute top-3.5 right-3.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              closeClassName,
            )}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </div>
      {footerChild ? (
        <div
          data-slot="dialog-footer-wrapper"
          className="shrink-0 px-2 pt-2 pb-1"
        >
          {footerChild}
        </div>
      ) : null}
    </>
  );

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "t-modal fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)] outline-none sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {formElement
          ? React.cloneElement(formElement, {
              className: cn("flex min-h-0 w-full flex-col gap-0", formElement.props.className),
              children: cardContent,
            })
          : cardContent}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-row items-center justify-between gap-3 w-full [&>*:only-child]:ml-auto",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline" data-cuelume-close data-cuelume-emphasis="subtle">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

type DialogTitleProps = React.ComponentProps<typeof DialogPrimitive.Title> & {
  icon?: React.ReactNode;
};

function DialogTitle({ className, icon, children, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "flex items-center gap-2.5 text-lg font-medium tracking-[-0.02em] text-foreground leading-normal",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="text-foreground/80 shrink-0 inline-flex items-center">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </DialogPrimitive.Title>
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function DialogShortcut({
  children,
  variant = "subtle",
  className,
}: {
  children: React.ReactNode;
  variant?: "subtle" | "primary" | "destructive";
  className?: string;
}) {
  return (
    <kbd
      data-slot="dialog-shortcut"
      className={cn(
        "inline-flex h-5 select-none items-center justify-center rounded px-1.5 font-mono text-[10px] font-medium tracking-[-0.02em] transition-colors",
        variant === "subtle" &&
          "border border-border/80 bg-background/80 text-muted-foreground shadow-2xs",
        variant === "primary" &&
          "bg-primary-foreground/20 text-primary-foreground",
        variant === "destructive" &&
          "bg-destructive-foreground/20 text-destructive-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function DialogCancel({
  className,
  children,
  showShortcut = false,
  asChild,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close> & {
  showShortcut?: boolean;
}) {
  if (asChild) {
    return (
      <DialogPrimitive.Close asChild {...props}>
        {children}
      </DialogPrimitive.Close>
    );
  }
  return (
    <DialogPrimitive.Close
      data-slot="dialog-cancel"
      data-cuelume-close
      data-cuelume-emphasis="subtle"
      className={cn(
        buttonVariants({ variant: "outline" }),
        "text-muted-foreground hover:text-foreground",
        showShortcut && "gap-2",
        className,
      )}
      {...props}
    >
      {children}
      {showShortcut && <DialogShortcut variant="subtle">esc</DialogShortcut>}
    </DialogPrimitive.Close>
  );
}

export {
  Dialog,
  DialogBody,
  DialogCancel,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogShortcut,
  DialogTitle,
  DialogTrigger,
  // Shared with the alert dialog, so both kinds of panel arrive the same way.
  useDialogOpenCue,
};
