"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { RocketIcon } from "@hugeicons/core-free-icons";
import { type FormEvent, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/provider";
import { formatUSD, priceFor, type BillingPeriod } from "@/lib/plans";

/**
 * "Suscribirse" for Pro and Managed: a hosted Oruka at `<subdomain>.oruka.si`
 * (SR-R1). The visitor picks the subdomain and the owner's email; the server
 * asks the fleet whether the subdomain is free and answers with the Stripe
 * Payment Link, which this sends the browser to. After paying, Stripe brings
 * them back to /start/ready and the fleet creates the install on its own.
 */

/** Hosted tenants live under this domain (the fleet's FLEET_BASE_DOMAIN). */
const HOSTED_DOMAIN = "oruka.si";

type Status = "idle" | "submitting" | "error";

export function HostedSignupDialog({
  emphasis,
  nameKey,
  period,
  plan,
}: {
  readonly emphasis?: boolean;
  readonly nameKey: string;
  readonly period: BillingPeriod;
  readonly plan: "pro" | "managed";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const price = priceFor(nameKey, period);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setStatus("idle");
      setErrorMessage(null);
    }
  }, []);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStatus("submitting");
      setErrorMessage(null);
      try {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, email, plan, period }),
        });
        const body = (await res.json().catch(() => null)) as { url?: string; code?: string; field?: string } | null;
        if (res.ok && body?.url) {
          // Stays "submitting": the page is leaving for Stripe.
          window.location.assign(body.url);
          return;
        }
        setStatus("error");
        setErrorMessage(
          body?.code === "conflict"
            ? t("pricing.signup.errorTaken")
            : body?.code === "invalid_field"
              ? t(body.field === "email" ? "pricing.signup.errorEmail" : "pricing.signup.errorSlug")
              : body?.code === "rate_limited"
                ? t("pricing.contactModal.form.errorRateLimited")
                : body?.code === "not_configured"
                  ? t("pricing.signup.errorUnavailable")
                  : t("pricing.signup.errorGeneric"),
        );
      } catch {
        setStatus("error");
        setErrorMessage(t("pricing.signup.errorGeneric"));
      }
    },
    [slug, email, plan, period, t],
  );

  const busy = status === "submitting";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="w-full" variant={emphasis ? "default" : "outline"}>
          {t("pricing.cta.subscribe")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medium tracking-[-0.02em]" icon={<HugeiconsIcon icon={RocketIcon} size={18} strokeWidth={1.75} />}>
            {t("pricing.signup.title", { plan: t(nameKey) })}
          </DialogTitle>
          <DialogDescription>{t("pricing.signup.body")}</DialogDescription>
        </DialogHeader>

        {price ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t(nameKey)} · {formatUSD(price.amount)} {t(price.periodKey)}
          </p>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="signup-slug" className="mb-1.5 block text-sm font-medium">
              {t("pricing.signup.subdomain")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="signup-slug"
                required
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                maxLength={32}
                pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/\s+/g, ""))}
                disabled={busy}
                aria-describedby="signup-slug-help"
              />
              <span className="shrink-0 text-sm text-muted-foreground">.{HOSTED_DOMAIN}</span>
            </div>
            <p id="signup-slug-help" className="mt-1.5 text-xs text-muted-foreground">
              {t("pricing.signup.subdomainHelp")}
            </p>
          </div>
          <div>
            <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium">
              {t("pricing.signup.email")}
            </label>
            <Input
              id="signup-email"
              type="email"
              required
              maxLength={320}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              aria-describedby="signup-email-help"
            />
            <p id="signup-email-help" className="mt-1.5 text-xs text-muted-foreground">
              {t("pricing.signup.emailHelp")}
            </p>
          </div>


          {errorMessage ? (
            <p className="text-xs text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner size={15} strokeWidth={2} /> : null}
              {busy ? t("pricing.signup.submitting") : t("pricing.signup.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
