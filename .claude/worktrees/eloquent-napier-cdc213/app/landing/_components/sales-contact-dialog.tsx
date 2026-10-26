"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowRight01Icon, Calendar03Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/provider";
import { useSmoothScroll } from "@/components/motion/smooth-scroll";
import { ENTITY } from "./legal-page";

/**
 * A modal form instead of a link, wherever the ask needs more than a click —
 * an Enterprise sale on `/pricing`, a general inquiry beside the client logos.
 * Posts to `/api/demo-request`, which saves the request before notifying the
 * team. Once saved, the visitor can optionally schedule with Cal.com using
 * the same contact details; an unscheduled request is still received.
 *
 * `source` rides along in the request body so the email subject on the other
 * end says what this actually is — the route defaults it to `"pricing"` so
 * the one existing call site (Enterprise, on `/pricing`) keeps its current
 * subject line unchanged.
 *
 * `website` is a honeypot: an off-screen field a real visitor never fills.
 * The server-side check lives in `app/api/demo-request/route.ts`; a filled
 * honeypot still gets `{ ok: true }` back so a bot has no signal to learn
 * from.
 */

type DemoRequestStatus = "idle" | "submitting" | "success" | "error";

export function SalesContactDialog({
  bodyKey,
  source,
  submitLabelKey = "pricing.contactModal.form.submit",
  titleKey,
  triggerLabelKey,
  triggerVariant = "button",
  triggerSize,
  triggerClassName = "w-full",
  emphasis = false,
}: {
  readonly bodyKey: string;
  /** "early-access": a hosted plan asked for while sales are closed. */
  readonly source: "pricing" | "clients" | "early-access";
  readonly submitLabelKey?: string;
  readonly titleKey: string;
  readonly triggerLabelKey: string;
  /** Filled rather than outlined, for the emphasised pricing card. */
  readonly emphasis?: boolean;
  /**
   * What the ask looks like where it sits. `"button"` is the outlined,
   * full-width control the pricing table needs, where the dialog is the
   * Enterprise tier's only action and has to weigh the same as the buy
   * buttons beside it.
   *
   * `"link"` is the arrow line every other section's call to action uses —
   * the one `SectionIntro` renders from `cta`. A section whose ask is a
   * secondary invitation gets the line; an outlined block under a paragraph
   * reads as a form the page is demanding be filled.
   */
  readonly triggerVariant?: "button" | "link";
  readonly triggerSize?: "sm" | "lg";
  readonly triggerClassName?: string;
}) {
  const t = useT();
  const formId = useId();
  const { lenis } = useSmoothScroll();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<DemoRequestStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    lenis?.stop();
    return () => { lenis?.start(); };
  }, [open, lenis]);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // Reopening starts clean — otherwise a second inquiry reopens showing
    // the first one's confirmation screen instead of an empty form.
    if (next) {
      setStatus("idle");
      setErrorMessage(null);
      setBookingUrl(null);
    }
  }, []);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStatus("submitting");
      setErrorMessage(null);
      try {
        const res = await fetch("/api/demo-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, email, company, message, website, source }),
        });
        if (res.ok) {
          const body = await res.json() as { bookingUrl?: string };
          setBookingUrl(typeof body.bookingUrl === "string" ? body.bookingUrl : null);
          setStatus("success");
          return;
        }
        const body = (await res.json().catch(() => null)) as { code?: string; field?: string } | null;
        setStatus("error");
        setErrorMessage(
          body?.code === "invalid_field" && body.field === "email"
            ? t("pricing.contactModal.form.errorInvalidEmail")
            : body?.code === "rate_limited"
              ? t("pricing.contactModal.form.errorRateLimited")
              : t("pricing.contactModal.form.errorGeneric"),
        );
      } catch {
        setStatus("error");
        setErrorMessage(t("pricing.contactModal.form.errorGeneric"));
      }
    },
    [name, email, company, message, website, source, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {triggerVariant === "link" ? (
          <button
            // `min-h-6`: the 24px WCAG 2.2 target-size floor — see the same
            // note on `SectionIntro`'s link in `primitives.tsx`.
            className="group inline-flex min-h-6 w-fit items-center gap-1.5 font-medium text-foreground text-sm"
            type="button"
          >
            {t(triggerLabelKey)}
            <HugeiconsIcon
              className="transition-transform duration-200 ease-[var(--lp-ease)] group-hover:translate-x-1"
              icon={ArrowRight01Icon}
              size={15}
              strokeWidth={2}
            />
          </button>
        ) : (
          <Button className={triggerClassName} size={triggerSize} variant={emphasis ? "default" : "outline"}>
            {t(triggerLabelKey)}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medium tracking-[-0.02em]" icon={<HugeiconsIcon icon={Mail01Icon} size={18} strokeWidth={1.75} />}>
            {t(titleKey)}
          </DialogTitle>
          <DialogDescription>{t(bodyKey)}</DialogDescription>
        </DialogHeader>

        {!ENTITY.email ? (
          <div className="rounded-xl border border-dashed border-muted-foreground/40 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {t("pricing.contactModal.unavailable")}
            </p>
          </div>
        ) : status === "success" ? (
          <div className="space-y-4">
            <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                {t("pricing.contactModal.form.successTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("pricing.contactModal.form.successBody", { email: ENTITY.email })}
              </p>
            </div>
            {bookingUrl ? <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("pricing.contactModal.form.bookingBody")}</p>
              {source === "early-access" ? <p className="text-xs text-muted-foreground">{t("pricing.contactModal.form.bookingBetaNote")}</p> : null}
              <DialogFooter>
                <Button asChild className="w-full">
                  <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
                    <HugeiconsIcon icon={Calendar03Icon} size={16} strokeWidth={1.75} />
                    {t("pricing.contactModal.form.bookCall")}
                  </a>
                </Button>
              </DialogFooter>
            </div> : null}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor={`${formId}-name`} className="mb-1.5 block text-sm font-medium">
                {t("pricing.contactModal.form.name")}
              </label>
              <Input
                id={`${formId}-name`}
                name="name"
                autoComplete="name"
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={status === "submitting"}
              />
            </div>
            <div>
              <label htmlFor={`${formId}-email`} className="mb-1.5 block text-sm font-medium">
                {t("pricing.contactModal.form.email")}
              </label>
              <Input
                id={`${formId}-email`}
                name="email"
                autoComplete="email"
                spellCheck={false}
                type="email"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={status === "submitting"}
              />
            </div>
            <div>
              <label htmlFor={`${formId}-company`} className="mb-1.5 block text-sm font-medium">
                {t("pricing.contactModal.form.company")}
              </label>
              <Input
                id={`${formId}-company`}
                name="company"
                autoComplete="organization"
                required
                maxLength={200}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                disabled={status === "submitting"}
              />
            </div>
            <div>
              <label htmlFor={`${formId}-message`} className="mb-1.5 block text-sm font-medium">
                {t(source === "pricing" ? "pricing.contactModal.form.message" : "pricing.contactModal.form.businessMessage")}
              </label>
              <Textarea
                id={`${formId}-message`}
                name="message"
                autoComplete="off"
                rows={3}
                maxLength={4000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={status === "submitting"}
              />
            </div>

            {/* Honeypot — invisible and unreachable by tab, so no sighted or
                keyboard visitor ever touches it. Named so autofill does not
                recognise it either: Safari's contact card and password
                managers filled a field called "website", and the route
                silently drops a filled honeypot — a real inquiry, lost.
                The data-* attributes opt out of 1Password, LastPass,
                Bitwarden and Dashlane. */}
            <input
              type="text"
              name="oruka-hp"
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore=""
              data-form-type="other"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
            />

            {errorMessage ? <p role="alert" className="text-xs text-destructive">{errorMessage}</p> : null}

            <DialogFooter>
              <Button type="submit" className="w-full" disabled={status === "submitting"}>
                {status === "submitting" ? <Spinner size={15} strokeWidth={2} /> : null}
                {status === "submitting"
                  ? t("pricing.contactModal.form.submitting")
                  : t(submitLabelKey)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
