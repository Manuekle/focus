"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { CreditCardIcon, LockPasswordIcon } from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson, isApiError, type UiError } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import { Spinner } from "@/components/ui/spinner";

/**
 * Adding a card, from the billing page instead of a detour through /pricing.
 *
 * The dialog explains and hands off; it does not collect a card. Card fields
 * are entered on Stripe's own hosted page, so no card number ever reaches
 * this app, its logs, or its storage.
 */
export function PaymentMethodDialog({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await fetchJson<{ url: string }>("/api/billing/checkout", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "setup" }),
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    window.location.href = result.data.url;
  }, [t]);

  const needsKey = error !== null && isApiError(error) && error.code === "not_configured";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setBusy(false);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle icon={<HugeiconsIcon icon={CreditCardIcon} size={18} strokeWidth={1.75} />}>
            {t("billing.paymentDialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("billing.paymentDialogDescription")}</DialogDescription>
        </DialogHeader>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-[var(--shadow-inset)]">
            <HugeiconsIcon icon={LockPasswordIcon} size={15} strokeWidth={1.75} />
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("billing.paymentStripeNote")}
          </p>
        </div>

        {needsKey ? (
          <p className="text-[13px] text-muted-foreground">
            {t("billing.paymentNeedsKey")}{" "}
            <Link className="underline underline-offset-2" href="/settings">
              {t("billing.paymentNeedsKeyLink")}
            </Link>
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("billing.cancel")}</Button>
          </DialogClose>
          <Button disabled={busy} onClick={() => void start()}>
            {busy && <Spinner />}
            {busy ? t("billing.opening") : t("billing.paymentContinue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
