"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";
import { DialogShortcut, useDialogOpenCue } from "./dialog";

function AlertDialog({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  // `warning`, not the plain dialog's `open`. Every confirm in this app is a
  // destructive one — `ConfirmOptions` has no gentle variant, and the resolver
  // documents `true` as "the destructive action" — so a mallet fifth that
  // asks for a look is more honest than the same air a settings sheet gets.
  //
  // Same rule as the plain dialog otherwise: sound the arrival and a
  // dismissal, never the exit the confirm itself causes. That one is followed
  // by the caller's own `close` for the delete it just authorised.
  const handleOpenChange = useDialogOpenCue(open, onOpenChange, "warning");

  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      open={open}
      onOpenChange={handleOpenChange}
      {...props}
    />
  );
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "t-scrim fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function isAlertFooterElement(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) return false;
  const props = child.props as Record<string, unknown> | undefined;
  return (
    child.type === AlertDialogFooter ||
    props?.["data-slot"] === "alert-dialog-footer" ||
    props?.["data-slot"] === "dialog-footer"
  );
}

function flattenAlertChildren(children: React.ReactNode): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      result.push(...flattenAlertChildren((child.props as { children?: React.ReactNode }).children));
    } else if (child !== null && child !== undefined && child !== false) {
      result.push(child);
    }
  });
  return result;
}

function AlertDialogContent({
  className,
  bodyClassName,
  children,
  variant = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  bodyClassName?: string;
  variant?: "default" | "plain";
}) {
  if (variant === "plain") {
    return (
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className={cn(
            "t-modal fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-float)] outline-none sm:max-w-md",
            className,
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Content>
      </AlertDialogPortal>
    );
  }

  const childArray = flattenAlertChildren(children);
  const bodyChildren: React.ReactNode[] = [];
  let footerChild: React.ReactNode = null;

  for (const item of childArray) {
    if (isAlertFooterElement(item)) {
      footerChild = item;
    } else {
      bodyChildren.push(item);
    }
  }

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "t-modal fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)] outline-none sm:max-w-md",
          className,
        )}
        {...props}
      >
        <div
          data-slot="alert-dialog-card"
          className={cn(
            "relative flex min-h-0 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[14px] border border-border/50 bg-card p-4 shadow-xs sm:p-5",
            bodyClassName,
          )}
        >
          {bodyChildren}
        </div>
        {footerChild && (
          <div
            data-slot="alert-dialog-footer-wrapper"
            className="shrink-0 px-2 pt-2 pb-1"
          >
            {footerChild}
          </div>
        )}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-row items-center justify-between gap-3 w-full [&>*:only-child]:ml-auto",
        className,
      )}
      {...props}
    />
  );
}

type AlertDialogTitleProps = React.ComponentProps<typeof AlertDialogPrimitive.Title> & {
  icon?: React.ReactNode;
};

function AlertDialogTitle({
  className,
  icon,
  children,
  ...props
}: AlertDialogTitleProps) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "flex items-center gap-2.5 text-lg font-medium tracking-[-0.02em] text-foreground leading-normal",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="text-destructive shrink-0 inline-flex items-center">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </AlertDialogPrimitive.Title>
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  children,
  showShortcut = false,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & {
  showShortcut?: boolean;
}) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant: "destructive" }), showShortcut && "gap-2", className)}
      {...props}
    >
      {children}
      {showShortcut && <DialogShortcut variant="destructive">↵</DialogShortcut>}
    </AlertDialogPrimitive.Action>
  );
}

function AlertDialogCancel({
  className,
  children,
  showShortcut = false,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & {
  showShortcut?: boolean;
}) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
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
    </AlertDialogPrimitive.Cancel>
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
