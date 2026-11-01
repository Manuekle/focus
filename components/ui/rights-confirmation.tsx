"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { Dialog } from "radix-ui";
import { Button } from "./button";
import { RIGHTS_COPY } from "../../shared/rights";
import { rightsStore } from "../../shared/rights-store";

/**
 * The person's answer for one asset (or set of assets). Never starts checked,
 * and a different asset key is always unconfirmed. `guard()` is for the
 * processing action: false means "do not start", and the error then shows.
 */
export function useRightsConfirmation(assetKey: string | null) {
  const confirmed = useSyncExternalStore(
    rightsStore.subscribe,
    () => assetKey !== null && rightsStore.isConfirmed(assetKey),
    () => false,
  );
  const [attemptedKey, setAttemptedKey] = useState<string | null>(null);
  const setConfirmed = useCallback((value: boolean) => {
    if (assetKey !== null) rightsStore.setConfirmed(assetKey, value);
  }, [assetKey]);
  const guard = useCallback(() => {
    if (confirmed) return true;
    setAttemptedKey(assetKey);
    return false;
  }, [confirmed, assetKey]);
  return { confirmed, setConfirmed, guard, invalid: !confirmed && attemptedKey !== null && attemptedKey === assetKey, ready: assetKey !== null };
}

function RightsInfo({ children }: { readonly children: React.ReactNode }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="t-scrim fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="t-modal fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6 outline-none"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <Dialog.Title className="font-[family-name:var(--font-sn-pro)] text-base leading-[1.4] font-semibold text-balance text-foreground">{RIGHTS_COPY.dialogTitle}</Dialog.Title>
          <Dialog.Description className="sr-only">{RIGHTS_COPY.dialogLead}</Dialog.Description>
          <div className="flex flex-col gap-3 text-xs leading-5 text-muted-foreground">
            <p>{RIGHTS_COPY.dialogLead}</p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {RIGHTS_COPY.dialogItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
            {RIGHTS_COPY.dialogNotes.map((note) => <p key={note}>{note}</p>)}
          </div>
          <div className="flex justify-end">
            <Dialog.Close asChild>
              <Button size="sm" className="text-xs md:text-xs" autoFocus>{RIGHTS_COPY.dialogAction}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The checkbox that sits with an upload. Native input, so keyboard and screen
 * readers work as they do everywhere; the message is tied to it with
 * aria-describedby and announced when processing is refused.
 */
export function RightsConfirmation({ confirmed, onConfirmedChange, invalid = false, disabled = false, className }: {
  readonly confirmed: boolean;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`flex flex-col gap-1.5 text-left ${className ?? ""}`}>
      <p className="text-xs font-medium text-foreground/80">{RIGHTS_COPY.heading}</p>
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
        <label htmlFor={id} className="cursor-pointer text-xs leading-5 text-pretty text-muted-foreground">{RIGHTS_COPY.label}</label>
      </div>
      <div className="pl-[26px]">
        <RightsInfo>
          <button type="button" className="rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {RIGHTS_COPY.link}
          </button>
        </RightsInfo>
      </div>
      {invalid ? <p id={errorId} role="alert" className="pl-[26px] text-xs text-destructive">{RIGHTS_COPY.error}</p> : null}
    </div>
  );
}
