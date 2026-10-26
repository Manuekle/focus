"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AlertCircleIcon, ArrowRight01Icon, Coins01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { Button } from "@/components/ui/button";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

// The one thing about AI an owner needs to know: how much is left.
//
// Pro and Managed include AI Credits, so an owner on either never needs a key
// and this card only says how many credits are left and when they renew. The
// way to get more — a bigger plan, or their own key — appears only when it is
// needed: credits running low, or a plan that carries none. Nobody is sold
// an upgrade they have no use for.

type Balance = {
  readonly unlimited: boolean;
  readonly plan?: string;
  readonly balance?: number;
  readonly monthlyAllocation?: number;
  readonly periodEnd?: string | null;
  readonly hasIncludedCredits?: boolean;
};

/** Included credits per plan, for when the balance itself cannot be read
 *  (it lives in Postgres; see lib/credit-account.ts). */
const PLAN_CREDITS: Record<string, number> = { pro: 100_000, managed: 500_000 };

/** Below this share of the month's credits, the card offers a way to get more. */
const LOW_SHARE = 0.2;

export function AiCreditsCard({
  ownKey,
  onUseOwnKey,
}: {
  /** An AI provider key is configured: calls use it and spend no credits. */
  readonly ownKey: boolean;
  readonly onUseOwnKey: () => void;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ readonly balance: Balance | null; readonly plan: string } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      fetch("/api/credits/balance")
        .then((response) => (response.ok ? (response.json() as Promise<Balance>) : null))
        .catch(() => null),
      fetch("/api/billing/plan")
        .then((response) => (response.ok ? (response.json() as Promise<{ plan?: string }>) : null))
        .catch(() => null),
    ]).then(([balance, plan]) => {
      if (live) setState({ balance, plan: balance?.plan ?? plan?.plan ?? "none" });
    });
    return () => {
      live = false;
    };
  }, []);

  const number = (value: number) => Math.max(0, Math.round(value)).toLocaleString(locale);

  if (!state) {
    return (
      <CardShell>
        <SkeletonBar className="h-4 w-40" />
        <SkeletonBar className="mt-4 h-9 w-full rounded-full" />
        <SkeletonBar className="mt-3 h-3 w-56" />
      </CardShell>
    );
  }

  const { balance, plan } = state;
  const included = balance?.monthlyAllocation ?? PLAN_CREDITS[plan] ?? 0;
  const left = balance?.balance;
  const unlimited = balance?.unlimited ?? plan === "enterprise";
  const noCredits = !unlimited && included === 0;
  const share = left !== undefined && included > 0 ? left / included : null;
  const low = !ownKey && share !== null && share < LOW_SHARE;
  const empty = !ownKey && left !== undefined && left <= 0 && included > 0;
  const renewsLabel = balance?.periodEnd
    ? t("aiUsage.renewsOn", {
        date: new Date(balance.periodEnd).toLocaleDateString(locale, { day: "numeric", month: "short" }),
      })
    : null;

  return (
    <CardShell tone={empty || (noCredits && !ownKey) ? "warn" : "plain"}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/75 shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={Coins01Icon} size={18} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t("aiUsage.creditsTitle")}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {unlimited
              ? t("settings.credits.unlimited")
              : noCredits
                ? ownKey
                  ? t("settings.credits.ownKeyOnly")
                  : t("settings.credits.none")
                : left !== undefined
                  ? t("settings.credits.left", { left: number(left), total: number(included) })
                  : t("settings.credits.included", { plan: t(`plan.${plan}.name`, undefined, plan), total: number(included) })}
          </p>
        </div>
        <Link
          href="/settings/ai-usage"
          className="inline-flex min-h-9 shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("settings.viewUsage")}
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>

      {share !== null && !unlimited ? (
        <ProgressMeter
          className="mt-4"
          value={share * 100}
          tone={empty ? "critical" : low ? "low" : "ok"}
          label={renewsLabel}
          aria-label={t("aiUsage.creditsTitle")}
          aria-valuemax={included}
          aria-valuenow={Math.max(0, left ?? 0)}
          aria-valuetext={[`${number(left ?? 0)} / ${number(included)}`, renewsLabel].filter(Boolean).join(", ")}
        />
      ) : null}

      {ownKey && !unlimited ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("settings.credits.usingOwnKey")}</p>
      ) : null}

      {/* The way to get more, only when there is a reason to want it. */}
      {(low || empty || noCredits) && !ownKey ? (
        <div className="mt-4 rounded-xl bg-muted/60 p-3">
          <p className="flex items-start gap-2 text-sm">
            <HugeiconsIcon icon={AlertCircleIcon} size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-600" />
            {empty ? t("settings.credits.emptyHint") : noCredits ? t("settings.credits.noneHint") : t("settings.credits.lowHint")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/account/billing">{t("settings.credits.morePlan")}</Link>
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onUseOwnKey}>
              <HugeiconsIcon icon={Key01Icon} size={14} strokeWidth={1.75} />
              {t("settings.credits.ownKey")}
            </Button>
          </div>
        </div>
      ) : null}
    </CardShell>
  );
}

function CardShell({ children, tone = "plain" }: { readonly children: React.ReactNode; readonly tone?: "plain" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded-[20px] border bg-card p-5 shadow-[var(--shadow-float)] lg:col-span-2",
        tone === "warn" ? "border-amber-500/40" : "border-border/70",
      )}
    >
      {children}
    </div>
  );
}
