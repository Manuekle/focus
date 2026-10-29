"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "radix-ui";

import { Button } from "./button";

export type ConfirmOptions = {
  /** The question, as a short sentence ending in "?". */
  readonly title: string;
  /** What happens if they go ahead. */
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /**
   * Destructive by default: asking at all usually means something goes away.
   * `default` is for confirmations that only move forward.
   */
  readonly tone?: "destructive" | "default";
};

type Settled = (value: boolean) => void;

function ConfirmDialogView({ options, onDone }: { readonly options: ConfirmOptions; readonly onDone: Settled }) {
  const [open, setOpen] = React.useState(true);
  const settled = React.useRef(false);

  const answer = (value: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setOpen(false);
    onDone(value);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) answer(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="t-scrim fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="t-modal fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-2xl outline-none"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-1.5">
            <Dialog.Title className="font-[family-name:var(--font-sn-pro)] text-base leading-[1.4] font-semibold text-balance break-words text-foreground">{options.title}</Dialog.Title>
            {options.description ? (
              <Dialog.Description className="text-xs leading-5 text-pretty text-muted-foreground">{options.description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{options.title}</Dialog.Description>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs md:text-xs"
              onClick={() => answer(false)}
              autoFocus
            >
              {options.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={options.tone === "default" ? "default" : "destructive"}
              size="sm"
              className="text-xs md:text-xs"
              onClick={() => answer(true)}
            >
              {options.confirmLabel ?? "Delete"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Asks before something irreversible, in the app's own dialog instead of the
 * browser's `confirm()` — which can't be styled, blocked by the browser, or
 * described properly. Resolves `true` when the person goes ahead.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let done = false;
    root.render(
      <ConfirmDialogView
        options={options}
        onDone={(value) => {
          if (done) return;
          done = true;
          resolve(value);
          // Past the close animation (150ms) so the dialog is seen leaving.
          window.setTimeout(() => {
            root.unmount();
            host.remove();
          }, 200);
        }}
      />,
    );
  });
}
