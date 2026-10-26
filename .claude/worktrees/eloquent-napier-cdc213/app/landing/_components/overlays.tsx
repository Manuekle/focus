"use client";

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import type { CSSProperties, ReactNode } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/provider";
import type { ChannelId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The panels that sit on top of each rebuilt screen.
 *
 * The screen behind them shows the shape of the product; the overlay shows the
 * one fact the section is actually making a claim about. Splitting the two is
 * what keeps the screenshots free of callout arrows and annotation labels —
 * the annotation *is* a piece of the interface, lifted out and floated.
 *
 * They are positioned by the caller and drift in a beat after the screen
 * lands (`--lp-d`). They do not keep moving afterwards: a card that floats
 * forever is motion with nothing to say, and it costs a compositor layer for
 * the life of the page to say it.
 */

function OverlayShell({
  children,
  className,
  delay = 0,
  style,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      data-reveal
      className={cn("lp-overlay absolute z-[5] backdrop-blur-xl backdrop-saturate-150", className)}
      style={{ ...style, "--lp-d": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * An incoming message and the reply the agent sent back, with the gap between
 * them stated in seconds. The whole product argument in one card.
 */
export function ConversationOverlay({
  className,
  delay,
  incoming,
  reply,
  channel = "whatsapp",
  who,
}: {
  readonly channel?: ChannelId;
  readonly className?: string;
  readonly delay?: number;
  readonly incoming: string;
  readonly reply: string;
  readonly who: string;
}) {
  const t = useT();

  return (
    <OverlayShell className={cn("w-[19rem] p-3.5", className)} delay={delay}>
      <div className="flex items-center gap-2 border-border border-b pb-2.5">
        <div className="flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ChannelIcon channel={channel} className="size-3.5" />
        </div>
        <p className="min-w-0 flex-1 truncate font-medium text-xs">{who}</p>
        <StatusBadge status="success" label="4 s" />
      </div>

      <p className="mt-2.5 rounded-xl rounded-tl-md bg-muted px-3 py-2 text-[11px] leading-relaxed text-foreground/90">
        {incoming}
      </p>
      <p className="mt-1.5 ml-6 rounded-xl rounded-tr-md bg-primary px-3 py-2 text-[11px] leading-relaxed text-primary-foreground">
        {reply}
      </p>
      <p className="mt-2 text-[10px] text-muted-foreground">
        {t("landing.overlay.repliedByPrefix")} <span className="text-foreground/80">oruka</span> ·{" "}
        {t("landing.overlay.repliedBySuffix")}
      </p>
    </OverlayShell>
  );
}

/** A single number with its label and the movement behind it. */
export function MetricOverlay({
  className,
  delay,
  delta,
  icon,
  label,
  value,
}: {
  readonly className?: string;
  readonly delay?: number;
  readonly delta?: string;
  readonly icon: IconSvgElement;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <OverlayShell className={cn("w-[13.5rem] p-3.5", className)} delay={delay}>
      <div className="flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
        </div>
        <p className="font-medium text-[11px] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2.5 text-xl font-medium leading-none tracking-[-0.02em] tabular-nums">{value}</p>
      {delta ? <p className="mt-1.5 text-[10px] text-muted-foreground">{delta}</p> : null}
    </OverlayShell>
  );
}

/** The agent mid-task: what it was asked, what it touched, how long it took. */
export function AgentOverlay({
  className,
  delay,
  prompt,
  result,
  steps,
}: {
  readonly className?: string;
  readonly delay?: number;
  readonly prompt: string;
  readonly result: string;
  readonly steps: readonly string[];
}) {
  const t = useT();

  return (
    <OverlayShell className={cn("w-[20rem] p-3.5", className)} delay={delay}>
      <div className="flex items-center gap-2 border-border border-b pb-2.5">
        <span className="font-medium text-xs">
          <span className="text-foreground">oruka</span>
        </span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
          Claude Opus 5
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">{t("landing.overlay.workedDuration")}</span>
      </div>

      <p className="mt-2.5 rounded-xl bg-muted px-3 py-2 text-[11px] leading-relaxed">{prompt}</p>

      <ul className="mt-2.5 space-y-1.5">
        {steps.map((step) => (
          <li key={step} className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className="truncate">{step}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 border-border border-t pt-2.5 text-[11px] leading-relaxed text-foreground/90">{result}</p>
    </OverlayShell>
  );
}
