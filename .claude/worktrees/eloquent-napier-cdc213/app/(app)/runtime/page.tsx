"use client";

import "../product.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  ArrowDown01Icon,
  CodeIcon,
  Delete01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useHosted } from "@/lib/hosted-context";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/provider";
import { usePolling } from "@/lib/use-polling";
import { fetchJson, uiErrorMessage, type UiError } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { StackReport } from "@/lib/agent-stack";
import type { EveInfoResult } from "@/lib/eve-info";
import type { RuntimeSessionSummary } from "@/lib/runtime-store";
import type { RunPlan, RuntimeLogEntry } from "@/lib/types";
import { StackPanel } from "./_components/stack-panel";
import { LoadedPanel } from "./_components/loaded-panel";
import { LogStream } from "./_components/log-stream";
import { PlanList } from "./_components/plan-list";
import { ActivityFeed, counted } from "./_components/activity-feed";

// What the agents did, for the owner — and the runtime underneath, for
// whoever maintains the install.
//
// The page opens on a feed an owner can read: one card per conversation,
// what the agent did in it in plain words, the plan it followed. Under that,
// folded away, the same data the way a developer wants it:
//
//   1. **Is the stack wired?** Six packages and their configuration
//      (self-hosted only: Oruka runs the stack on hosted installs).
//   2. **What is it doing?** The log tail, grouped by session.
//   3. **What did it plan?** The agent's own checklists, ticked off live.
//   4. **What is loaded?** The runtime's `/eve/v1/info` snapshot — the honest
//      answer to "does it have that tool", after dynamic resolvers ran.
//
// Polling, not streaming. Eve's own NDJSON stream is per session and only
// exists while a turn runs; this page's whole point is the runs nobody was
// watching. Incremental polls send `?since=` so a quiet minute costs one small
// request, and the poll stands down while the tab is hidden — a dashboard left
// open in a background tab should not bill a request every two seconds
// forever.

const LOG_POLL_MS = 4_000;

type LogsResponse = {
  readonly logs?: RuntimeLogEntry[];
  readonly sessions?: RuntimeSessionSummary[];
};

export default function RuntimePage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const hosted = useHosted();
  const [tab, setTab] = useState<"logs" | "steps" | "loaded">("logs");
  const [technical, setTechnical] = useState(false);
  const [stack, setStack] = useState<StackReport | null>(null);
  const [info, setInfo] = useState<EveInfoResult | null>(null);
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [plans, setPlans] = useState<RunPlan[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const [live, setLive] = useState(true);

  const newest = logs[0]?.at;

  /** One tick. `since` is what the newest held line says, so a quiet poll
   *  returns an empty array instead of the whole tail. */
  const loadLogs = useCallback(
    async (incremental: boolean) => {
      const query = incremental && newest ? `?since=${encodeURIComponent(newest)}` : "";
      const result = await fetchJson<LogsResponse>(`/api/runtime/logs${query}`, t);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      const fresh = result.data.logs ?? [];
      if (incremental) {
        // Nothing new is the common case and must not re-render the list.
        if (fresh.length === 0) return;
        setLogs((current) => {
          // Deduplicate by id rather than trusting `since` alone. The first
          // poll tick fires on mount, before the full load has landed a
          // `newest` timestamp to send — so it asks for everything and would
          // otherwise prepend a second copy of the whole tail.
          const seen = new Set(current.map((entry) => entry.id));
          const added = fresh.filter((entry) => !seen.has(entry.id));
          if (added.length === 0) return current;
          return [...added, ...current].slice(0, 400);
        });
      } else {
        setLogs(fresh);
      }
      if (result.data.sessions) setSessions(result.data.sessions);
    },
    [newest, t],
  );

  const loadPlans = useCallback(async () => {
    const result = await fetchJson<{ plans?: RunPlan[] }>("/api/runtime/plans", t);
    if (result.ok) setPlans(result.data.plans ?? []);
  }, [t]);

  const loadStack = useCallback(async () => {
    const result = await fetchJson<StackReport>("/api/runtime/stack", t);
    if (result.ok) setStack(result.data);
  }, [t]);

  const loadInfo = useCallback(async () => {
    const result = await fetchJson<EveInfoResult>("/api/runtime/info", t);
    if (result.ok) setInfo(result.data);
  }, [t]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStack(), loadInfo(), loadLogs(false), loadPlans()]);
  }, [loadStack, loadInfo, loadLogs, loadPlans]);

  useEffect(() => {
    void refreshAll().finally(() => setIsLoading(false));
    // Deliberately once, on mount. `refreshAll` changes identity whenever the
    // newest log line does, and re-running the full load on every tick would
    // undo the incremental poll below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A hidden tab is a tab nobody is reading. `visibilitychange` is what keeps
  // an abandoned dashboard from polling all afternoon.
  useEffect(() => {
    const onVisibility = () => setLive(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const tick = useCallback(async () => {
    await Promise.all([loadLogs(true), loadPlans()]);
  }, [loadLogs, loadPlans]);

  usePolling(tick, LOG_POLL_MS, live);

  const clearLogs = useCallback(async () => {
    const ok = await confirm({
      title: t("runtime.clearConfirm"),
      description: t("runtime.clearConfirmBody"),
      confirmLabel: t("runtime.clear"),
    });
    if (!ok) return;
    const result = await fetchJson("/api/runtime/logs", t, { method: "DELETE" });
    if (result.ok) {
      setLogs([]);
      setSessions([]);
      setSessionFilter(null);
      toast({ title: t("runtime.cleared") });
    } else {
      toast({ title: uiErrorMessage(t, result.error), status: "error" });
    }
  }, [confirm, t, toast]);

  const tabs = useMemo(
    () => [
      { id: "logs", label: `${t("runtime.tabLogs")}${logs.length ? ` (${logs.length})` : ""}` },
      { id: "steps", label: `${t("runtime.tabSteps")}${plans.length ? ` (${plans.length})` : ""}` },
      { id: "loaded", label: t("runtime.tabLoaded") },
    ],
    [logs.length, plans.length, t],
  );

  const actions = sessions.reduce((sum, session) => sum + session.toolCalls, 0);
  const failed = sessions.filter((session) => session.status === "failed").length;

  return (
    <PageContainer
      banner={error ? (
          <ErrorBanner layout="strip" error={error} onRetry={() => void refreshAll()} />
        ) : null}
      maxWidth="max-w-4xl"
      title={t("runtime.title")}
      description={t("runtime.subtitle")}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshAll()}
          aria-label={t("runtime.refresh")}
        >
          <HugeiconsIcon icon={Loading03Icon} size={15} strokeWidth={1.75} />
          <span className="hidden sm:inline">{t("runtime.refresh")}</span>
        </Button>
      }
    >
      <div className="content-enter">
        {!isLoading && sessions.length > 0 ? (
          <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{counted(t, "activity.summarySessions", sessions.length)}</span>
            <span aria-hidden="true">·</span>
            <span>{counted(t, "activity.summaryActions", actions)}</span>
            {failed > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[color:var(--status-failed-fg)]">{t("activity.summaryFailed", { count: failed })}</span>
              </>
            ) : null}
          </p>
        ) : null}

        <ActivityFeed sessions={sessions} logs={logs} plans={plans} isLoading={isLoading} locale={locale} />

        {/* Everything below is for whoever maintains the install: the raw
            log, the agent's checklists as data, what the runtime loaded and
            the packages under it. Folded, so the owner reading what their
            agents did never has to scroll past environment variables. */}
        <Collapsible open={technical} onOpenChange={setTechnical} className="mt-10 border-t border-border pt-4">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
            <span className="flex items-center gap-2">
              <HugeiconsIcon icon={CodeIcon} size={15} strokeWidth={1.75} />
              {t("activity.technical")}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={15}
              strokeWidth={1.75}
              className="transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-6 pt-4">
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("activity.technicalHint")}</p>
            {!hosted ? <StackPanel report={stack} isLoading={isLoading} /> : null}

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SlidingTabs tabs={tabs} value={tab} onValueChange={(id) => setTab(id as typeof tab)} />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void clearLogs()}
                >
                  <HugeiconsIcon icon={Delete01Icon} size={15} strokeWidth={1.75} />
                  {t("runtime.clear")}
                </Button>
              </div>

              {/* Keyed on the tab so each switch plays one short entrance
                  instead of swapping content in place. */}
              <div key={tab} className="content-enter">
                {tab === "logs" ? (
                  <LogStream
                    logs={logs}
                    sessions={sessions}
                    isLoading={isLoading}
                    locale={locale}
                    sessionFilter={sessionFilter}
                    onSessionFilter={setSessionFilter}
                  />
                ) : null}

                {tab === "steps" ? (
                  <PlanList
                    plans={sessionFilter ? plans.filter((p) => p.sessionId === sessionFilter) : plans}
                    isLoading={isLoading}
                    locale={locale}
                  />
                ) : null}

                {tab === "loaded" ? <LoadedPanel result={info} isLoading={isLoading} /> : null}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      {confirmDialog}
    </PageContainer>
  );
}
