"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  BubbleChatIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  InstagramIcon,
  Link01Icon,
  Loading03Icon,
  TaskDone01Icon,
  UserGroupIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { relativeTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/provider";
import type { RuntimeSessionSummary } from "@/lib/runtime-store";
import type { ChannelId, RunPlan, RunStepStatus, RuntimeLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

// What the agents did, told the way an owner would tell it.
//
// The runtime log is written for whoever debugs the agent: "Llamando
// search_knowledge", "Paso 2 — tool-calls". This reads the same log and says
// "Buscó en lo que sabe tu negocio", one card per conversation, with the
// plan the agent made for it when there was one. The raw log is still on the
// page, folded under "Detalles técnicos".

type Translate = ReturnType<typeof useT>;

/** `key` for most counts, `${key}One` for exactly one: "1 acción", not "1 acciones". */
export function counted(t: Translate, key: string, count: number): string {
  return t(count === 1 ? `${key}One` : key, { count });
}

type Moment = {
  readonly label: string;
  readonly tone: "done" | "failed" | "connect";
  readonly count: number;
  readonly subject?: string;
};

const CHANNEL_ICONS: Record<ChannelId | "internal", IconSvgElement> = {
  whatsapp: WhatsappIcon,
  instagram: InstagramIcon,
  web: BubbleChatIcon,
  internal: TaskDone01Icon,
};

/** A tool's name as something the agent did. `eve:subagent:x` and friends
 *  are the framework's own prefixes and never reach the owner. */
function actionLabel(t: Translate, tool: string | undefined): string {
  if (!tool) return t("activity.tool.unknown");
  if (tool.startsWith("eve:load-skill")) return t("activity.tool.skill");
  const name = tool.replace(/^mcp__[^_]+__/, "");
  const words = name.replace(/[_-]+/g, " ").trim();
  return t(`activity.tool.${name}`, undefined, t("activity.tool.other", { name: words }));
}

/** One session's log, oldest first, folded into the things worth saying. */
function momentsOf(t: Translate, entries: readonly RuntimeLogEntry[]): Moment[] {
  const moments: Moment[] = [];
  for (const entry of entries) {
    let next: Moment | null = null;
    if (entry.event === "action.result") {
      next = { label: actionLabel(t, entry.subject), tone: entry.level === "error" ? "failed" : "done", count: 1 };
    } else if (entry.event === "subagent.called") {
      next = { label: t("activity.helper", { name: entry.subject ?? "" }), tone: "done", count: 1 };
    } else if (entry.event === "authorization.required") {
      next = { label: t("activity.connect", { name: entry.subject ?? "" }), tone: "connect", count: 1, subject: entry.subject };
    } else if (entry.event === "step.failed") {
      next = { label: t("activity.problem"), tone: "failed", count: 1 };
    }
    if (!next) continue;
    const last = moments.at(-1);
    // "Buscó en lo que sabe tu negocio" three times in a row is one line.
    if (last && last.label === next.label && last.tone === next.tone) {
      moments[moments.length - 1] = { ...last, count: last.count + 1 };
    } else {
      moments.push(next);
    }
  }
  return moments;
}

export function ActivityFeed({
  sessions,
  logs,
  plans,
  isLoading,
  locale,
}: {
  readonly sessions: readonly RuntimeSessionSummary[];
  readonly logs: readonly RuntimeLogEntry[];
  readonly plans: readonly RunPlan[];
  readonly isLoading: boolean;
  readonly locale: Locale;
}) {
  const t = useT();

  const bySession = useMemo(() => {
    const map = new Map<string, RuntimeLogEntry[]>();
    // `logs` is newest first; a card reads in the order things happened.
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const entry = logs[index];
      const list = map.get(entry.sessionId);
      if (list) list.push(entry);
      else map.set(entry.sessionId, [entry]);
    }
    return map;
  }, [logs]);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <SkeletonBar className="h-4 w-48" />
            <SkeletonBar className="h-3 w-full max-w-md" />
            <SkeletonBar className="h-3 w-2/3 max-w-sm" />
          </div>
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={TaskDone01Icon} size={18} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium">{t("activity.emptyTitle")}</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{t("activity.emptyHint")}</p>
        <Button asChild variant="outline" className="mt-1">
          <Link href="/chat">{t("activity.emptyAction")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {sessions.map((session) => (
        <li key={session.sessionId}>
          <SessionCard
            session={session}
            moments={momentsOf(t, bySession.get(session.sessionId) ?? [])}
            plan={plans.find((plan) => plan.sessionId === session.sessionId) ?? null}
            locale={locale}
          />
        </li>
      ))}
    </ol>
  );
}

const STATUS_STYLE: Record<RuntimeSessionSummary["status"], { readonly dot: string; readonly key: string }> = {
  running: { dot: "bg-[color:var(--status-progress-fg)] animate-pulse", key: "activity.status.running" },
  completed: { dot: "bg-[color:var(--status-success-fg)]", key: "activity.status.completed" },
  failed: { dot: "bg-[color:var(--status-failed-fg)]", key: "activity.status.failed" },
};

const VISIBLE_MOMENTS = 4;

function SessionCard({
  session,
  moments,
  plan,
  locale,
}: {
  readonly session: RuntimeSessionSummary;
  readonly moments: readonly Moment[];
  readonly plan: RunPlan | null;
  readonly locale: Locale;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const channel = session.channel ?? "internal";
  const status = STATUS_STYLE[session.status];
  const shown = open ? moments : moments.slice(0, VISIBLE_MOMENTS);
  const hidden = moments.length - shown.length;

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-inset)] sm:p-5">
      <header className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/75">
          <HugeiconsIcon icon={CHANNEL_ICONS[channel]} size={17} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t(`activity.channel.${channel}`)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {relativeTime(session.lastAt, locale)}
            {moments.length > 0 ? ` · ${counted(t, "activity.actions", session.toolCalls)}` : ""}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", status.dot)} />
          {t(status.key)}
        </span>
      </header>

      {moments.length > 0 ? (
        <ul className="mt-3 space-y-1.5 pl-12">
          {shown.map((moment, index) => (
            <li key={index} className="flex items-start gap-2 text-sm leading-snug">
              <HugeiconsIcon
                icon={moment.tone === "failed" ? AlertCircleIcon : moment.tone === "connect" ? Link01Icon : CheckmarkCircle02Icon}
                size={14}
                strokeWidth={1.75}
                className={cn(
                  "mt-0.5 shrink-0",
                  moment.tone === "failed"
                    ? "text-[color:var(--status-failed-fg)]"
                    : moment.tone === "connect"
                      ? "text-[color:var(--status-progress-fg)]"
                      : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 text-foreground/85">
                {moment.label}
                {moment.count > 1 ? <span className="text-muted-foreground"> ×{moment.count}</span> : null}
                {moment.tone === "failed" && moment.label !== t("activity.problem") ? (
                  <span className="text-[color:var(--status-failed-fg)]"> · {t("activity.didNotWork")}</span>
                ) : null}
                {moment.tone === "connect" ? (
                  <Link href="/connections" className="ml-1.5 font-medium underline underline-offset-4">
                    {t("activity.connectAction")}
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
          {hidden > 0 || open ? (
            <li>
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {open ? t("activity.showLess") : t("activity.showMore", { count: hidden })}
                <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} className={cn("transition-transform", open ? "-rotate-90" : "rotate-90")} />
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-3 pl-12 text-sm text-muted-foreground">
          {session.subagents > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={UserGroupIcon} size={14} strokeWidth={1.75} />
              {counted(t, "activity.helpers", session.subagents)}
            </span>
          ) : session.status === "running" ? (
            t("activity.inProgress")
          ) : (
            t("activity.justReplied")
          )}
        </p>
      )}

      {plan ? <PlanSteps plan={plan} /> : null}
    </article>
  );
}

const STEP_ICON: Record<RunStepStatus, { readonly icon: IconSvgElement; readonly className: string; readonly spin?: boolean }> = {
  pending: { icon: CircleIcon, className: "text-muted-foreground/60" },
  running: { icon: Loading03Icon, className: "text-[color:var(--status-progress-fg)]", spin: true },
  done: { icon: CheckmarkCircle02Icon, className: "text-[color:var(--status-success-fg)]" },
  failed: { icon: CancelCircleIcon, className: "text-[color:var(--status-failed-fg)]" },
  skipped: { icon: ArrowRight01Icon, className: "text-muted-foreground/60" },
};

/** The checklist the agent made for this conversation, as it ticked it off. */
function PlanSteps({ plan }: { readonly plan: RunPlan }) {
  const t = useT();
  const done = plan.steps.filter((step) => step.status === "done").length;
  return (
    <div className="mt-4 ml-12 rounded-xl bg-muted/50 p-3">
      <p className="flex items-center justify-between gap-2 text-xs font-medium">
        <span className="truncate">{plan.title}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {t("activity.planProgress", { done, total: plan.steps.length })}
        </span>
      </p>
      <ul className="mt-2 space-y-1">
        {plan.steps.map((step) => {
          const style = STEP_ICON[step.status];
          return (
            <li key={step.id} className="flex items-start gap-2 text-xs leading-relaxed">
              <HugeiconsIcon
                icon={style.icon}
                size={13}
                strokeWidth={1.75}
                className={cn("mt-0.5 shrink-0", style.className, style.spin && "animate-spin")}
              />
              <span className={cn("min-w-0", step.status === "skipped" && "text-muted-foreground line-through")}>
                {step.title}
                {step.note ? <span className="block text-muted-foreground">{step.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
