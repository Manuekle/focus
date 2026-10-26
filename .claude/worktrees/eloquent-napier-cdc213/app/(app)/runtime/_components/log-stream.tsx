"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { Card } from "../../../_components/dashboard-card";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { fullTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/provider";
import type { RuntimeLogEntry, RuntimeLogLevel } from "@/lib/types";
import type { RuntimeSessionSummary } from "@/lib/runtime-store";
import { cn } from "@/lib/utils";

// The log tail.
//
// One line per event, newest first, with the detail folded away behind a
// click. The compressed form is what makes a log readable at all: a run is
// twenty lines, and twenty expanded JSON payloads is a wall nobody scans.
//
// What is *not* here is as deliberate as what is. No message bodies, no full
// tool arguments — agent/hooks/runtime-log.ts records the shape of a call, not
// its contents, so this page never becomes a second copy of customer data with
// its own deletion problem.

const LEVEL_TONE: Record<RuntimeLogLevel, { readonly icon: typeof AlertCircleIcon; readonly text: string }> = {
  info: { icon: InformationCircleIcon, text: "text-muted-foreground" },
  warn: { icon: AlertCircleIcon, text: "text-[color:var(--status-pending-fg)]" },
  error: { icon: AlertCircleIcon, text: "text-[color:var(--status-failed-fg)]" },
};

const FILTER_ICON = {
  all: CheckmarkCircle02Icon,
  info: InformationCircleIcon,
  warn: AlertCircleIcon,
  error: AlertCircleIcon,
} as const;

const FILTER_TONE = {
  all: "text-muted-foreground",
  info: "text-[color:var(--status-progress-fg)]",
  warn: "text-[color:var(--status-pending-fg)]",
  error: "text-[color:var(--status-failed-fg)]",
} as const;

/** Short session labels. A session id is 30+ characters and the only part
 *  anybody uses is enough of it to tell two apart. */
function shortSession(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-3)}` : id;
}

function LogRow({ entry, locale }: { readonly entry: RuntimeLogEntry; readonly locale: Locale }) {
  const [open, setOpen] = useState(false);
  const tone = LEVEL_TONE[entry.level];
  const expandable = !!entry.detail;

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        className={cn(
          "flex w-full items-start gap-2.5 px-3 py-2 text-left",
          expandable ? "cursor-pointer hover:bg-muted" : "cursor-default",
        )}
        aria-expanded={expandable ? open : undefined}
      >
        <HugeiconsIcon
          icon={tone.icon}
          size={14}
          strokeWidth={2}
          className={cn("mt-0.5 shrink-0", tone.text)}
        />
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {fullTime(entry.at, locale).split(" ").slice(-1)[0] ?? ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.summary}</span>
        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
          {entry.event}
        </span>
        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground md:inline">
          {shortSession(entry.sessionId)}
        </span>
      </button>
      {open && entry.detail ? (
        <pre className="overflow-x-auto border-t border-border bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {entry.detail}
        </pre>
      ) : null}
    </li>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  locale,
}: {
  readonly session: RuntimeSessionSummary;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly locale: Locale;
}) {
  const icon =
    session.status === "failed"
      ? AlertCircleIcon
      : session.status === "running"
        ? InformationCircleIcon
        : CheckmarkCircle02Icon;
  const tone =
    session.status === "failed"
      ? "text-[color:var(--status-failed-fg)]"
      : session.status === "running"
        ? "text-[color:var(--status-progress-fg)]"
        : "text-[color:var(--status-success-fg)]";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted",
        active && "bg-muted",
      )}
      aria-pressed={active}
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={2} className={cn("shrink-0", tone)} />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {shortSession(session.sessionId)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{session.lastSummary}</span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {session.toolCalls}t
        {session.subagents > 0 ? ` · ${session.subagents}s` : ""}
        {session.errors > 0 ? ` · ${session.errors}e` : ""}
      </span>
      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
        {fullTime(session.lastAt, locale)}
      </span>
    </button>
  );
}

export function LogStream({
  logs,
  sessions,
  isLoading,
  locale,
  sessionFilter,
  onSessionFilter,
}: {
  readonly logs: readonly RuntimeLogEntry[];
  readonly sessions: readonly RuntimeSessionSummary[];
  readonly isLoading: boolean;
  readonly locale: Locale;
  readonly sessionFilter: string | null;
  readonly onSessionFilter: (sessionId: string | null) => void;
}) {
  const [level, setLevel] = useState<RuntimeLogLevel | "all">("all");
  const t = useT();

  const visible = useMemo(
    () =>
      logs.filter((entry) => {
        if (level !== "all" && entry.level !== level) return false;
        if (sessionFilter && entry.sessionId !== sessionFilter) return false;
        return true;
      }),
    [logs, level, sessionFilter],
  );

  if (isLoading && logs.length === 0) {
    return (
      <Card className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-3 py-2.5">
            <SkeletonBar className="h-3 w-full" />
          </div>
        ))}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("runtime.sessions")}
            </h3>
            {sessionFilter ? (
              <button
                type="button"
                onClick={() => onSessionFilter(null)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t("runtime.viewAll")}
              </button>
            ) : null}
          </div>
          <Card className="overflow-hidden">
            {sessions.slice(0, 8).map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                active={sessionFilter === session.sessionId}
                onSelect={() =>
                  onSessionFilter(sessionFilter === session.sessionId ? null : session.sessionId)
                }
                locale={locale}
              />
            ))}
          </Card>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("runtime.events")}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "info", "warn", "error"] as const).map((option) => (
              <ToggleChip
                key={option}
                selected={level === option}
                onClick={() => setLevel(option)}
                className={cn("gap-1.5", FILTER_TONE[option])}
              >
                <HugeiconsIcon icon={FILTER_ICON[option]} size={13} strokeWidth={2} />
                {option === "all"
                  ? t("runtime.filterAll")
                  : option === "info"
                    ? t("runtime.filterInfo")
                    : option === "warn"
                      ? t("runtime.filterWarn")
                      : t("runtime.filterError")}
              </ToggleChip>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-foreground">{t("runtime.logsEmpty")}</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              {t("runtime.logsEmptyHint")}
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul>
              {visible.map((entry) => (
                <LogRow key={entry.id} entry={entry} locale={locale} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
