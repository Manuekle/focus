"use client";

import { LockPasswordIcon, Tick02Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/icon";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import styles from "./progress.module.css";
import { STAGES, type StageName } from "./stages";

/**
 * What a buyer watches on /start/ready while the fleet builds their Oruka
 * (SR-R1). It polls /api/signup/status with the checkout session Stripe put
 * in the redirect, and draws the real stage the fleet reports — nothing here
 * advances on a timer. The buyer's own address is the centrepiece: it is
 * still being assembled while the stages run, and becomes the link when the
 * install is ready.
 *
 * Copy arrives from the server in both languages and is picked with the
 * site's own locale (stored preference, else the browser), so the page reads
 * in the same language as the navigation around it. This file holds no
 * strings of its own.
 */

type Stage = StageName | "ready";
type State = "confirming" | "building" | "delayed" | "ready";
type Status = { state: State; stage: Stage; domain: string | null };

export type ProgressCopy = {
  readonly eyebrow: string;
  readonly title: string;
  readonly readyTitle: string;
  readonly lede: string;
  readonly readyBody: string;
  readonly readyCta: string;
  readonly address: string;
  readonly elapsed: string;
  readonly stepOf: string;
  readonly delayed: string;
  readonly unavailable: string;
  readonly stages: Readonly<Record<StageName, { readonly label: string; readonly detail: string }>>;
  /** Reached without Stripe's redirect: nothing to follow. */
  readonly noSession: string;
  readonly home: string;
};

const POLL_MS = 3_000;
const SLOW_POLL_MS = 12_000;
/** Consecutive failed polls before the page says it cannot see the progress. */
const BLIND_AFTER = 4;

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ProvisioningProgress({
  copies,
  session,
}: {
  readonly copies: Readonly<Record<Locale, ProgressCopy>>;
  readonly session: string | null;
}) {
  const { locale } = useI18n();
  const copy = copies[locale] ?? copies.es;
  if (!session) {
    return (
      <div className="mx-auto w-full max-w-[38rem]">
        <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{copy.eyebrow}</p>
        <h1 className={cn("font-cooper text-[clamp(2.1rem,6vw,3.4rem)] leading-[1.02] font-medium tracking-[-0.02em]", styles.enter)}>{copy.title}</h1>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">{copy.noSession}</p>
        <Button asChild variant="outline" className="mt-8">
          <Link href={locale === "en" ? "/en" : "/"}>{copy.home}</Link>
        </Button>
      </div>
    );
  }
  return <Progress copy={copy} session={session} />;
}

function Progress({ copy, session }: { readonly copy: ProgressCopy; readonly session: string }) {
  const [status, setStatus] = useState<Status>({ state: "confirming", stage: "payment", domain: null });
  const [failures, setFailures] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const ready = status.state === "ready";
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (ready) return;
    startedAt.current ??= Date.now();
    const started = startedAt.current;
    const tick = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, [ready]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let misses = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/signup/status?session=${encodeURIComponent(session)}`, { cache: "no-store" });
        const body = (await response.json()) as Partial<Status> & { code?: string };
        if (!response.ok || !body.state) throw new Error(body.code ?? String(response.status));
        misses = 0;
        if (!stopped) {
          setFailures(0);
          setStatus({ state: body.state, stage: body.stage ?? "payment", domain: body.domain ?? null });
        }
        if (body.state === "ready") return;
      } catch {
        misses += 1;
        if (!stopped) setFailures(misses);
      }
      if (!stopped) timer = window.setTimeout(poll, misses >= BLIND_AFTER ? SLOW_POLL_MS : POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [session]);

  const currentIndex = ready ? STAGES.length : Math.max(0, STAGES.indexOf(status.stage as StageName));
  // The payment is done the moment the fleet knows about the checkout.
  const doneCount = ready ? STAGES.length : status.state === "confirming" ? 0 : currentIndex;
  const percent = Math.round(((ready ? STAGES.length : doneCount + 0.5) / STAGES.length) * 100);
  const [slug, ...rest] = (status.domain ?? "").split(".");
  const suffix = rest.length ? `.${rest.join(".")}` : ".oruka.si";
  const origin = status.domain ? `https://${status.domain}` : null;

  return (
    <div className="mx-auto w-full max-w-[38rem]">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{copy.eyebrow}</p>
      <h1 className={cn("font-cooper text-[clamp(2.1rem,6vw,3.4rem)] leading-[1.02] font-medium tracking-[-0.02em]", styles.enter)}>
        {ready ? copy.readyTitle : copy.title}
      </h1>
      <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
        {ready ? copy.readyBody : copy.lede}
      </p>

      {/* The address, still being assembled — then the way in. */}
      <div className="mt-10">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{copy.address}</p>
        <a
          href={ready && origin ? `${origin}/login` : undefined}
          aria-disabled={!ready}
          className={cn(
            styles.address,
            !ready && styles.sheen,
            "lp-focus flex items-center gap-3 rounded-2xl border bg-background/40 px-5 py-4 font-mono text-[15px] transition-colors duration-500",
            ready ? "border-foreground/40 hover:border-foreground/70" : "pointer-events-none border-border",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-500",
              ready ? "bg-foreground text-background" : "text-muted-foreground",
            )}
          >
            {ready ? (
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2.2} className={cn("size-3.5", styles.check)} />
            ) : (
              <HugeiconsIcon icon={LockPasswordIcon} size={14} strokeWidth={1.75} className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">https://</span>
            {status.domain ? (
              <span className="text-foreground">{slug}</span>
            ) : (
              <span className="inline-block h-[1em] w-24 translate-y-[0.15em] rounded bg-muted-foreground/15 align-baseline" />
            )}
            <span className="text-muted-foreground">{suffix}</span>
          </span>
          <span className="absolute inset-x-0 bottom-0 h-[2px] bg-border/60" aria-hidden="true">
            <span className={cn("block h-full bg-foreground/70", styles.fill)} style={{ width: `${percent}%` }} />
          </span>
        </a>
        {ready && origin ? (
          <Button asChild className={cn("mt-4 w-full sm:w-auto", styles.enter)}>
            <a href={`${origin}/login`}>{copy.readyCta}</a>
          </Button>
        ) : null}
      </div>

      {/* The stages, as the fleet reports them. */}
      <ol className="relative mt-10 flex flex-col gap-0.5" aria-label={copy.title}>
        {STAGES.map((stage, index) => {
          const done = index < doneCount;
          const current = !ready && !done && index === currentIndex;
          const text = copy.stages[stage];
          return (
            <li key={stage} className="relative flex gap-4 pb-5 last:pb-0" aria-current={current ? "step" : undefined}>
              {index < STAGES.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[11px] top-7 bottom-1 w-px transition-colors duration-700",
                    done ? "bg-foreground/35" : "bg-border",
                  )}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "relative mt-0.5 grid size-[23px] shrink-0 place-items-center rounded-full border transition-colors duration-500",
                  done && "border-foreground bg-foreground text-background",
                  current && "border-foreground/60",
                  !done && !current && "border-border",
                )}
              >
                {done ? (
                  <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2.4} className={cn("size-3", styles.check)} />
                ) : current ? (
                  <span className={cn("size-2 rounded-full bg-foreground", status.state === "delayed" ? "opacity-60" : styles.pulse)} />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className={cn("text-[15px] transition-colors duration-500", done || current ? "text-foreground" : "text-muted-foreground")}>
                  {text.label}
                </p>
                <div className={cn(styles.detail, current && styles.detailOpen)}>
                  <p className="overflow-hidden text-[13px] leading-relaxed text-muted-foreground">
                    {fill(text.detail, { domain: status.domain ?? "" })}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className={cn("mt-8 text-[13px] text-muted-foreground", !ready && "border-t pt-5")} aria-live="polite">
        {status.state === "delayed" ? (
          <p>{copy.delayed}</p>
        ) : failures >= BLIND_AFTER ? (
          <p>{copy.unavailable}</p>
        ) : !ready ? (
          <p className="tabular-nums">
            {fill(copy.elapsed, { time: clock(seconds) })} ·{" "}
            {fill(copy.stepOf, { step: String(Math.min(currentIndex + 1, STAGES.length)), total: String(STAGES.length) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
