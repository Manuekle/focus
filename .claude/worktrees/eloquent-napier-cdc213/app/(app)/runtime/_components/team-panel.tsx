"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AiChat02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Settings02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/motion/checkbox";
import { ErrorBanner } from "@/components/ui/error-banner";
import { DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { getAgentTemplate } from "@/lib/agent-templates";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useI18n } from "@/lib/i18n/provider";
import { usePolling } from "@/lib/use-polling";
import type { TeamState } from "@/lib/team-types";
import { cn } from "@/lib/utils";
import { TeamFeed, type FeedAgent } from "./team-feed";

type TeamResponse = {
  team: TeamState;
  workspaceId: string;
  agents: FeedAgent[];
  configured: boolean;
  /** The team follows the active agents on its own. */
  auto: boolean;
};

type Mode = "auto" | "manual";

function TeamSettingsLayout({ children, actions, drawer }: {
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly drawer: boolean;
}) {
  const { t } = useI18n();

  if (!drawer) {
    return <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="team-title">{children}{actions}</section>;
  }

  return (
    <DrawerContent closeClassName="top-4 right-4 size-8">
      <DrawerHeader className="px-6 py-5 pr-14">
        <DrawerTitle icon={<HugeiconsIcon icon={Settings02Icon} size={18} strokeWidth={1.75} />}>
          {t("agentTeam.configure")}
        </DrawerTitle>
      </DrawerHeader>
      <DrawerBody className="px-6 py-6">{children}</DrawerBody>
      {actions ? <DrawerFooter className="px-2 py-1">{actions}</DrawerFooter> : null}
    </DrawerContent>
  );
}

function AgentLabel({ agent }: { readonly agent: FeedAgent }) {
  const template = getAgentTemplate(agent.iconKey);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-lg", template?.accent ?? "bg-muted text-muted-foreground")}>
        <HugeiconsIcon icon={template?.icon ?? AiChat02Icon} size={18} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium leading-5">{agent.name}</span>
        {agent.description ? <span className="mt-0.5 block break-words text-xs leading-5 text-muted-foreground">{agent.description}</span> : null}
      </span>
    </span>
  );
}

export function TeamSkeleton({
  label,
  feedOnly = false,
  fill = false,
}: {
  readonly label: string;
  readonly feedOnly?: boolean;
  readonly fill?: boolean;
}) {
  // `/working` renders the feed edge to edge. Its previous loading state was
  // the configuration panel plus one oversized rectangle, so the left rail
  // and the conversation appeared only after the request completed.
  if (feedOnly && fill) {
    return (
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-rows-1 md:grid-cols-[18rem_minmax(0,1fr)]" aria-busy="true" aria-label={label}>

        <aside className="flex max-h-[45dvh] min-h-0 min-w-0 flex-col overflow-y-auto border-b border-border bg-muted/30 md:max-h-none md:border-r md:border-b-0">
          <div className="y-fade max-h-[45dvh] shrink-0 overflow-y-auto p-4">
            <SkeletonBar className="h-3 w-20" />
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5">
                  <SkeletonBar className="size-12 rounded-full" />
                  <SkeletonBar className="h-3 w-12" />
                  <SkeletonBar className="h-3 w-14 rounded-md" />
                </div>
              ))}
            </div>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col border-t border-border px-2 py-3">
            <SkeletonBar className="mx-2 h-3 w-24 shrink-0" />
            <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={cn("flex items-start gap-3 rounded-xl px-2 py-2.5", i === 0 && "bg-card shadow-[var(--shadow-soft)]")}>
                  <SkeletonBar className="mt-0.5 size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SkeletonBar className="h-3 w-full" />
                    <SkeletonBar className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </nav>

          <div className="y-fade max-h-[30dvh] shrink-0 overflow-y-auto border-t border-border p-4">
            <SkeletonBar className="h-3 w-20" />
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex gap-2">
                  <SkeletonBar className="size-5 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <SkeletonBar className="h-3 w-full" />
                    <SkeletonBar className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden p-5 sm:p-7">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-3 border-b border-border pb-5">
              <SkeletonBar className="size-12 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-4 w-44" />
                <SkeletonBar className="h-3 w-28" />
              </div>
              <SkeletonBar className="h-6 w-20 rounded-full" />
            </div>
            <div className="space-y-7 py-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <SkeletonBar className="mt-0.5 size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonBar className="h-3 w-28" />
                    <SkeletonBar className="h-4 w-full max-w-2xl" />
                    <SkeletonBar className="h-4 w-4/5 max-w-xl" />
                    {i % 2 === 0 ? <SkeletonBar className="h-10 w-full max-w-lg rounded-xl" /> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <SkeletonBar className="h-4 w-40" />
        <SkeletonBar className="h-3 w-full max-w-lg" />
        <SkeletonBar className="h-14 w-full rounded-lg" />
        <div className="grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <SkeletonBar key={i} className="h-14 rounded-lg" />)}
        </div>
      </div>
      {feedOnly ? <SkeletonBar className="h-[28rem] w-full rounded-2xl" /> : null}
    </div>
  );
}

export function TeamPanel({
  feedOnly = false,
  fill = false,
  onSetup,
  settingsDrawer = false,
}: {
  readonly feedOnly?: boolean;
  readonly fill?: boolean;
  /** Opens the settings from the feed (see app/(app)/working). */
  readonly onSetup?: () => void;
  readonly settingsDrawer?: boolean;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(20);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update(); document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const load = useCallback(async () => {
    const result = await fetchJson<TeamResponse>("/api/team", t);
    if (!result.ok) { setError(result.error); return; }
    setData(result.data); setError(null);
    if (!dirty) { setSelected(result.data.team.agentIds); setLimit(result.data.team.dailyLimit); }
  }, [t, dirty]);
  usePolling(load, 4000, visible && !busy);

  const save = async (next: { enabled: boolean; mode: Mode }) => {
    setBusy(true);
    const result = await fetchJson("/api/team", t, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...next, agentIds: selected, dailyLimit: limit }),
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setDirty(false);
    await load();
  };

  if (!data) {
    const loading = (
      <div className={cn("space-y-4", fill && "flex min-h-0 flex-1 flex-col")}>
        <ErrorBanner error={error} onRetry={() => void load()} />
        {!error ? <TeamSkeleton label={t("agentTeam.loading")} feedOnly={feedOnly} fill={fill} /> : null}
      </div>
    );
    return feedOnly ? loading : <TeamSettingsLayout drawer={settingsDrawer}>{loading}</TeamSettingsLayout>;
  }

  const { auto, configured } = data;
  const enabled = data.team.enabled;
  const calls = data.team.day === new Date().toISOString().slice(0, 10) ? data.team.calls : 0;
  const validLimit = Number.isInteger(limit) && limit >= 1 && limit <= 100;
  const actions = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      {enabled && <Button variant="outline" disabled={busy} onClick={() => void save({ enabled: false, mode: "manual" })}>{t("agentTeam.pause")}</Button>}
      {auto ? (
        <Button disabled={busy || !configured || !validLimit || !dirty} aria-busy={busy} onClick={() => void save({ enabled, mode: "auto" })}>
          {t(busy ? "agentTeam.saving" : "agentTeam.save")}
        </Button>
      ) : (
        <Button disabled={busy || !configured || selected.length < 2 || !validLimit} aria-busy={busy} onClick={() => void save({ enabled: true, mode: "manual" })}>
          {t(busy ? "agentTeam.saving" : enabled ? "agentTeam.save" : "agentTeam.start")}
        </Button>
      )}
    </div>
  );

  return (
    <div className={cn(settingsDrawer ? "h-full min-h-0 w-full" : "content-enter space-y-5", fill && "flex min-h-0 flex-1 flex-col")}>
      {/* /working renders the conversation (feedOnly) and opens this config
          — mode, participants, daily limit — in a drawer of its own. */}
      {!feedOnly ? (
      <TeamSettingsLayout drawer={settingsDrawer} actions={<div className={cn(!settingsDrawer && "mt-6 border-t border-border/60 pt-4")}>{actions}</div>}>
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="team-title" className="text-base font-medium tracking-tight">{t("agentTeam.title")}</h3>
              <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                <span aria-hidden="true" className={cn("size-1.5 rounded-full transition-colors duration-300", enabled ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                {t(enabled ? "agentTeam.enabled" : "agentTeam.paused")}
              </span>
            </div>
            <p className="text-pretty text-sm leading-6 text-muted-foreground">{t("agentTeam.description")}</p>
          </div>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <div className="flex items-start justify-between gap-4 rounded-xl bg-muted/50 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("agentTeam.mode.auto")}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("agentTeam.mode.autoHint")}</p>
            </div>
            <Switch
              checked={auto}
              className="mt-0.5"
              label={t("agentTeam.mode.auto")}
              disabled={busy || !configured}
              onCheckedChange={(on) => void save({ mode: on ? "auto" : "manual", enabled })}
            />
          </div>

          <section className="space-y-3" aria-labelledby="team-participants">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="flex items-center gap-2">
                <h3 id="team-participants" className="text-sm font-medium">{t("agentTeam.participants")}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{t("agentTeam.participantCount", { count: selected.length })}</span>
              </div>
              <Link className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href="/agents">
                {t("agentTeam.manageAgents")}<HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
              </Link>
            </div>
            {!auto ? <p className="text-xs leading-5 text-muted-foreground">{t("agentTeam.participantsHint")}</p> : null}
            {data.agents.length > 0 ? (
              <div className="space-y-2">
                {data.agents.map((agent) => auto ? (
                  <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <div className="min-w-0 flex-1"><AgentLabel agent={agent} /></div>
                    {selected.includes(agent.id) ? <HugeiconsIcon aria-hidden="true" icon={Tick02Icon} size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" /> : null}
                  </div>
                ) : (
                  <Checkbox
                    key={agent.id}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/60 p-3 transition-colors duration-150 has-[[aria-checked=true]]:border-primary/30 has-[[aria-checked=true]]:bg-primary/5 hover:bg-muted/50 has-disabled:cursor-default [&>span]:flex-1"
                    checked={selected.includes(agent.id)}
                    disabled={busy || !configured || (!selected.includes(agent.id) && selected.length >= 6)}
                    onCheckedChange={(checked) => {
                      setDirty(true);
                      setSelected((ids) => checked ? [...ids, agent.id] : ids.filter((id) => id !== agent.id));
                    }}
                    label={<AgentLabel agent={agent} />}
                    aria-label={agent.name}
                  />
                ))}
              </div>
            ) : null}
            {(!configured || data.agents.length < 2) && (
              <div className="space-y-2 rounded-xl bg-muted/50 p-3.5">
                {!configured && <p className="text-xs leading-5 text-muted-foreground">{t("agentTeam.needsDatabase")}</p>}
                {data.agents.length < 2 && <p className="text-xs leading-5 text-muted-foreground">{t("agentTeam.needsAgents")}</p>}
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border/60 pt-5" aria-labelledby="team-budget">
            <div className="flex items-center justify-between gap-4">
              <label id="team-budget" htmlFor="team-daily-limit" className="text-sm font-medium">{t("agentTeam.dailyLimit")}</label>
              <Input id="team-daily-limit" className="h-9 w-20 shrink-0 text-center text-base tabular-nums sm:text-sm" type="number" inputMode="numeric" min={1} max={100} value={limit} disabled={busy} aria-describedby="team-usage" aria-invalid={!validLimit}
                onChange={(event) => { setDirty(true); setLimit(Number(event.target.value)); }} />
            </div>
            <p id="team-usage" className="text-xs tabular-nums text-muted-foreground">{t("agentTeam.usage", { used: calls, limit: data.team.dailyLimit })}</p>
            <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, (calls / data.team.dailyLimit) * 100)}%` }} />
            </div>
            {calls >= data.team.dailyLimit && <p role="status" className="text-xs leading-5 text-muted-foreground">{t("agentTeam.budgetReached")}</p>}
            {data.team.droppedEvents > 0 && <p role="status" className="text-xs leading-5 text-destructive">{t("agentTeam.overflow", { count: data.team.droppedEvents })}</p>}
          </section>
          <details className="group border-t border-border/60 pt-4">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              {t("agentTeam.scopeTitle")}<HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} size={14} strokeWidth={1.75} className="shrink-0 group-open:rotate-180" />
            </summary>
            <p className="pt-3 text-pretty text-xs leading-6 text-muted-foreground">{t("agentTeam.scope")}</p>
          </details>
        </div>
      </TeamSettingsLayout>
      ) : null}
      {feedOnly ? (
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      ) : null}

      {feedOnly ? (
      <section
        {...(fill ? { "aria-label": t("agentTeam.feed") } : { "aria-labelledby": "team-feed" })}
        className={cn(fill ? "flex min-h-0 flex-1 flex-col" : "space-y-3")}
      >
        {!fill && <h2 id="team-feed" className="text-sm font-medium">{t("agentTeam.feed")}</h2>}
        <TeamFeed team={data.team} agents={data.agents} fill={fill} onSetup={onSetup} />
      </section>
      ) : null}
    </div>
  );
}
