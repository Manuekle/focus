"use client";

import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Locale } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";
import { localizedMarketingPath } from "@/lib/site";

// Find your workspace: an address goes to that workspace's own sign-in; an
// email gets its addresses by mail. The answer to the email is the same
// whether or not it belongs to a customer, so this page never tells a
// stranger who is one.

export type FinderCopy = Record<
  | "eyebrow" | "title" | "lede" | "addressLabel" | "addressPlaceholder" | "continue" | "checking"
  | "notFound" | "failed" | "forgot" | "emailLabel" | "emailPlaceholder" | "send" | "sending" | "sent"
  | "newHere" | "seePlans" | "admin",
  string
>;

type Status = "idle" | "busy" | "error" | "done";

export function WorkspaceFinder({
  copies,
  baseDomain,
}: {
  readonly copies: Record<Locale, FinderCopy>;
  readonly baseDomain: string;
}) {
  const { locale } = useI18n();
  const copy = copies[locale] ?? copies.es;
  const addressId = useId();
  const emailId = useId();

  const [address, setAddress] = useState("");
  const [find, setFind] = useState<{ status: Status; message?: string }>({ status: "idle" });
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [remind, setRemind] = useState<{ status: Status; message?: string }>({ status: "idle" });

  const submitAddress = async (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    setFind({ status: "busy" });
    try {
      const response = await fetch(`/api/workspaces?name=${encodeURIComponent(address.trim())}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { found?: boolean; url?: string } | null;
      if (!response.ok) {
        setFind({ status: "error", message: copy.failed });
        return;
      }
      if (body?.found && body.url) {
        window.location.assign(body.url);
        return;
      }
      setFind({ status: "error", message: copy.notFound });
    } catch {
      setFind({ status: "error", message: copy.failed });
    }
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setRemind({ status: "busy" });
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), locale }),
      });
      setRemind(response.ok ? { status: "done", message: copy.sent } : { status: "error", message: copy.failed });
    } catch {
      setRemind({ status: "error", message: copy.failed });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[34rem]">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{copy.eyebrow}</p>
      <h1 className="text-balance text-3xl text-foreground sm:text-4xl font-medium tracking-[-0.02em]">{copy.title}</h1>
      <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">{copy.lede}</p>

      <form onSubmit={submitAddress} className="mt-10 space-y-3" noValidate>
        <label htmlFor={addressId} className="block text-sm font-medium text-foreground">
          {copy.addressLabel}
        </label>
        <div className="flex h-8 items-center overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring/40">
          <input
            id={addressId}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              if (find.status === "error") setFind({ status: "idle" });
            }}
            placeholder={copy.addressPlaceholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            aria-invalid={find.status === "error"}
            aria-describedby={find.status === "error" ? `${addressId}-error` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="shrink-0 pr-3.5 text-sm text-muted-foreground">.{baseDomain}</span>
        </div>
        {find.status === "error" ? (
          <p id={`${addressId}-error`} className="text-sm text-red-600 dark:text-red-400" role="alert">
            {find.message}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={find.status === "busy" || !address.trim()}>
          {find.status === "busy" ? <Spinner size={14} /> : null}
          {find.status === "busy" ? copy.checking : copy.continue}
        </Button>
      </form>

      <div className="mt-8 border-t border-border pt-6">
        {forgot ? (
          remind.status === "done" ? (
            <p className="text-sm leading-relaxed text-muted-foreground" role="status">
              {remind.message}
            </p>
          ) : (
            <form onSubmit={submitEmail} className="space-y-3" noValidate>
              <label htmlFor={emailId} className="block text-sm font-medium text-foreground">
                {copy.emailLabel}
              </label>
              <Input
                id={emailId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={copy.emailPlaceholder}
                autoComplete="email"
              />
              {remind.status === "error" ? (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {remind.message}
                </p>
              ) : null}
              <Button type="submit" variant="outline" className="w-full" disabled={remind.status === "busy" || !email.trim()}>
                {remind.status === "busy" ? <Spinner size={14} /> : null}
                {remind.status === "busy" ? copy.sending : copy.send}
              </Button>
            </form>
          )
        ) : (
          <button
            type="button"
            onClick={() => setForgot(true)}
            className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
          >
            {copy.forgot}
          </button>
        )}
      </div>

      <div className="mt-10 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {copy.newHere}{" "}
          <Link
            href={localizedMarketingPath("/pricing", locale)}
            prefetch={false}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {copy.seePlans}
          </Link>
        </p>
        <Link href="/login" prefetch={false} className="text-xs underline underline-offset-4 hover:text-foreground">
          {copy.admin}
        </Link>
      </div>
    </div>
  );
}
