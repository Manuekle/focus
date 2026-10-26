"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  CancelCircleIcon,
  ExternalLinkIcon,
} from "@hugeicons/core-free-icons";
import { Card, CardHeader, CardTitle } from "../../../_components/dashboard-card";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { useT } from "@/lib/i18n/provider";
import type { StackComponent, StackReport, StackStatus } from "@/lib/agent-stack";
import { cn } from "@/lib/utils";

// The six pieces of the Agent Stack, and whether each one is actually wired.
//
// Drawn as a grid of small cards rather than a table because the useful glance
// is "is anything red", and a table makes you read six rows to find out. The
// detail line under each name is the answer to "what is true right now", and
// the fix line only appears when there is something to do — a card with no
// call to action should not pretend to have one.

const TONE: Record<
  StackStatus,
  { readonly icon: string; readonly dot: string; readonly text: string }
> = {
  ok: {
    icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  warn: {
    icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  missing: {
    icon: "bg-[var(--status-failed-bg)] text-[color:var(--status-failed-fg)]",
    dot: "bg-[var(--status-failed-fg)]",
    text: "text-[color:var(--status-failed-fg)]",
  },
};

const ICON = {
  ok: CheckmarkCircle02Icon,
  warn: AlertCircleIcon,
  missing: CancelCircleIcon,
} as const;

const STATUS_LABEL: Record<StackStatus, string> = {
  ok: "stack.statusOk",
  warn: "stack.statusWarn",
  missing: "stack.statusMissing",
};

function StackCard({ component }: { readonly component: StackComponent }) {
  const t = useT();
  const tone = TONE[component.status];
  const detail = t(component.detail.key, component.detail.params);
  const fix = component.fix ? t(component.fix.key, component.fix.params) : null;
  return (
    <Card
      interactive
      className="flex h-full flex-col rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]"
    >
      <div className="flex h-full flex-1 flex-col">
        <div className="flex flex-1 flex-col overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-[var(--shadow-inset)]",
                tone.icon,
              )}
            >
              <HugeiconsIcon icon={ICON[component.status]} size={16} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate">{component.label}</CardTitle>
              <p title={detail} className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
                {detail}
              </p>
            </div>
          </CardHeader>

          <div className="flex min-h-[1.75rem] flex-wrap items-center gap-1.5 px-5 pb-4">
            {component.version ? (
              <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {component.version}
              </span>
            ) : null}
            {fix ? (
              <span title={fix} className={cn("line-clamp-1 min-w-0 flex-1 font-medium text-[11px] leading-relaxed", tone.text)}>
                {fix}
              </span>
            ) : null}
          </div>
        </div>

        {/* Status + docs — outside the inner border, same as connections cards */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
          <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone.text)}>
            <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
            {t(STATUS_LABEL[component.status])}
          </p>
          <a
            href={component.docs}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("runtime.docs")}
            <HugeiconsIcon icon={ExternalLinkIcon} size={12} strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </Card>
  );
}

export function StackPanel({
  report,
  isLoading,
}: {
  readonly report: StackReport | null;
  readonly isLoading: boolean;
}) {
  if (isLoading && !report) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]"
          >
            <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
              <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                <SkeletonBar className="size-9 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonBar className="h-4 w-28" />
                  <SkeletonBar className="h-3 w-full" />
                </div>
              </div>
              <div className="px-5 pb-4">
                <SkeletonBar className="h-3 w-2/3" />
              </div>
            </div>
            <div className="flex items-center justify-between px-2.5 pt-2 pb-0.5">
              <SkeletonBar className="h-3 w-20" />
              <SkeletonBar className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!report) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {report.components.map((component) => (
        <StackCard key={component.id} component={component} />
      ))}
    </div>
  );
}
