"use client";

import "../product.css";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  ZapIcon,
  Add01Icon,
  PlayIcon,
  PauseIcon,
  Delete01Icon,
  CopyIcon,
  Clock01Icon,
  AlertCircleIcon,
  GitBranchIcon,
  PencilEdit01Icon,
  Download01Icon,
  FileImportIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { Card, CardHeader, CardTitle, CardDescription, CardSeparator } from "../../_components/dashboard-card";
import { KpiBars, KpiCard } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton, AutomationsSkeleton } from "@/components/ai-elements/skeleton";
import { AutomationDialog } from "@/components/ai-elements/automation-dialog";
import { ChannelBadge, StatusBadge } from "../../_components/channel-badge";
import { CategoryBadge } from "@/components/ui/category-badge";
import { useI18n, useT } from "@/lib/i18n/provider";
import { useSound } from "@/components/sound-provider";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STEP_HUES, STEP_ICONS, STEP_LABEL_KEYS } from "@/lib/workflow-step-meta";
import { useCelebrate } from "@/components/use-celebrate";
import { Dialog } from "@/components/ui/dialog";
import {
  automationTemplateBody,
  countAutomationBlanks,
  type AutomationTemplate,
} from "@/lib/automation-templates";
import { n8nToAutomation, type N8nImport } from "@/lib/n8n-workflow";
import { toWorkflowSteps } from "@/lib/workflow-schema";
import type { Automation } from "@/lib/types";
import { AutomationTemplates } from "./_components/automation-templates";
import { N8nImportDialog } from "./_components/n8n-import-dialog";
import { RowAction } from "@/components/ui/row-action";
import { InstagramCommentAutomations } from "./_components/instagram-comment-automations";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { TRIGGER_ICONS, TRIGGER_LABELS, downloadN8nWorkflow } from "./_components/automation-meta";

/** Larger than any real workflow export; a guard against a wrong file, not a quota. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const IMPORT_ERRORS = {
  invalid_json: "automations.importErrorInvalidJson",
  not_n8n: "automations.importErrorNotN8n",
  empty: "automations.importErrorEmpty",
} as const;

export default function AutomationsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { cue } = useSound();
  const celebrate = useCelebrate();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const [automations, setAutomations] = useState<Automation[]>([]);
  /** What each automation's most recent run actually did — see LastRunChip. */
  const [lastRuns, setLastRuns] = useState<Record<string, LastRun>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  /** The template being turned into a draft right now. */
  const [usingTemplate, setUsingTemplate] = useState<string | null>(null);
  /** A parsed n8n file waiting for the operator to confirm it. */
  const [importing, setImporting] = useState<{ readonly fileName: string; readonly preview: N8nImport } | null>(null);
  const [importCreating, setImportCreating] = useState(false);
  // Flows and Instagram comment automations. `?tab=instagram` opens the
  // second, so the Instagram channel card can link straight to it.
  const [tab, setTab] = useState<"flows" | "instagram">("flows");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "instagram") setTab("instagram");
  }, []);
  const changeTab = (next: string) => {
    const value = next === "instagram" ? "instagram" : "flows";
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "instagram") url.searchParams.set("tab", "instagram");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  type ListResponse = {
    readonly automations?: Automation[];
    readonly lastRuns?: Record<string, LastRun>;
  };

  const load = useCallback(async () => {
    const result = await fetchJson<ListResponse>("/api/automations", t);
    if (result.ok) {
      setAutomations(result.data.automations ?? []);
      setLastRuns(result.data.lastRuns ?? {});
      setError(null);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every mutation answers with the whole list. Applying it only on success is
   * the point: a failed call used to be parsed the same way as a good one, so
   * `automations: undefined` emptied the page and made a rejected toggle look
   * like every automation had been deleted.
   */
  const mutate = useCallback(
    async (init: RequestInit & { url?: string }): Promise<Automation[] | null> => {
      const { url = "/api/automations", ...rest } = init;
      const result = await fetchJson<ListResponse>(url, t, rest);
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      setError(null);
      const list = result.data.automations ?? [];
      setAutomations(list);
      // Every mutation answers with the whole list, run summaries included, so
      // pausing one automation does not leave stale run chips on the others.
      setLastRuns(result.data.lastRuns ?? {});
      return list;
    },
    [t],
  );

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const handleToggle = (id: string) => {
    const current = automations.find((a) => a.id === id);
    const status = current?.status === "active" ? "paused" : "active";
    cue("toggle", { direction: status === "active" ? "forward" : "back" });
    void mutate(jsonInit("PUT", { id, status })).then((list) => {
      // Same rule as the flow page: the burst is for going live, and only
      // for going live. Every successful activation gets its own celebration.
      if (list && status === "active") celebrate();
    });
  };
  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: t("automations.confirmDelete") }))) return;
    // `close` falls shut — a deletion is a dismissal, not a win.
    cue("close");
    const list = await mutate({ url: `/api/automations?id=${encodeURIComponent(id)}`, method: "DELETE" });
    if (list) toast({ title: t("common.deleted"), description: t("common.deletedDescription"), status: "success" });
  };
  const handleDuplicate = (auto: Automation) => {
    void mutate(
      jsonInit("POST", {
        name: `${auto.name} (copia)`,
        description: auto.description,
        trigger: auto.trigger,
        triggerValue: auto.triggerValue,
        channel: auto.channel,
        steps: auto.steps ?? [],
      }),
      // The copy is confirmed once it exists, not once it was asked for — the
      // cue used to fire ahead of the POST and sounded the same when it failed.
    ).then((list) => {
      if (list) cue("success");
    });
  };
  // Creating only captures the basics — the workflow itself is built on its
  // own page (app/automations/[id]/page.tsx), not in this dialog.
  const handleCreate = (data: Omit<Automation, "id" | "status" | "responseCount" | "createdAt" | "steps">) => {
    void mutate(jsonInit("POST", data)).then((list) => {
      const created = list?.[0];
      if (created) router.push(`/automations/${created.id}`);
    });
  };
  const handleEdit = (auto: Automation) => {
    setEditingAutomation(auto);
    setDialogOpen(true);
  };
  const handleUpdate = (id: string, updates: Partial<Omit<Automation, "id" | "steps">>) => {
    void mutate(jsonInit("PUT", { id, ...updates }));
  };

  // A template is a filled-in create: same POST, then straight to the canvas,
  // where the draft's blanks are waiting to be filled.
  const handleUseTemplate = async (template: AutomationTemplate) => {
    if (usingTemplate) return;
    setUsingTemplate(template.id);
    const body = automationTemplateBody(template, locale);
    const list = await mutate(
      jsonInit("POST", {
        name: body.name,
        description: body.summary,
        trigger: template.trigger,
        triggerValue: body.triggerValue,
        channel: template.channel,
        steps: toWorkflowSteps(body.steps),
      }),
    );
    setUsingTemplate(null);
    const created = list?.[0];
    if (!created) return;
    cue("success");
    toast({
      title: t("automations.templateUsedToast", { name: created.name }),
      description: t("automations.templateUsedToastDesc"),
      status: "success",
    });
    router.push(`/automations/${created.id}`);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again (after fixing it) still fires.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast({ title: t("automations.importErrorTooLarge"), status: "error" });
      return;
    }
    const result = n8nToAutomation(await file.text(), { locale });
    if (!result.ok) {
      toast({ title: t(IMPORT_ERRORS[result.error]), status: "error" });
      return;
    }
    setImporting({ fileName: file.name, preview: result.automation });
  };

  const handleConfirmImport = async (name: string) => {
    if (!importing) return;
    const { preview } = importing;
    setImportCreating(true);
    const list = await mutate(
      jsonInit("POST", {
        name,
        description: preview.description,
        trigger: preview.trigger,
        triggerValue: preview.triggerValue,
        channel: preview.channel,
        steps: preview.steps,
      }),
    );
    setImportCreating(false);
    const created = list?.[0];
    if (!created) return;
    setImporting(null);
    cue("success");
    router.push(`/automations/${created.id}`);
  };

  const handleExport = (auto: Automation) => {
    downloadN8nWorkflow(auto, t);
    toast({ title: t("automations.exported"), description: t("automations.exportedDesc"), status: "success" });
  };

  const counts = {
    active: automations.filter((a) => a.status === "active").length,
    paused: automations.filter((a) => a.status === "paused").length,
    draft: automations.filter((a) => a.status === "draft").length,
  };

  /** One status's share of every automation, for the meter on its tile. */
  const share = (count: number) => (automations.length > 0 ? count / automations.length : 0);

  const sorted = [...automations].sort((a, b) => {
    const order = { active: 0, paused: 1, draft: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.responseCount - a.responseCount;
  });

  return (
    <PageContainer
      banner={
        <ErrorBanner
          layout="strip"
          error={error}
          onRetry={() => void load()}
          onDismiss={() => setError(null)}
        />
      }
      className="@container"
      maxWidth="max-w-6xl"
      title={t("automations.title")}
      description={t("automations.subtitle")}
      actions={tab === "flows" ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" aria-label={t("automations.import")} onClick={() => fileInputRef.current?.click()}>
                <HugeiconsIcon icon={FileImportIcon} size={16} strokeWidth={1.75} />
                <span className="hidden sm:inline">{t("automations.import")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("automations.importN8nHint")}</TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void handleImportFile(event)}
          />
          <Button
            size="sm"
            onClick={() => {
              setEditingAutomation(null);
              setDialogOpen(true);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
            {t("automations.new")}
          </Button>
        </>
      ) : null}
    >
        {confirmDialog}
        {dialogOpen ? (
          <AutomationDialog
            key={editingAutomation?.id ?? "new"}
            open={dialogOpen}
            editing={editingAutomation}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onClose={() => {
              setDialogOpen(false);
              setEditingAutomation(null);
            }}
          />
        ) : null}
        <Skeleton
          className="min-h-[500px]"
          isLoading={isLoading}
          skeleton={<AutomationsSkeleton view={tab} />}
        >
        <div className="content-enter">
        <SlidingTabs
          className="mb-6"
          tabs={[
            { id: "flows", label: t("automations.tabFlows") },
            { id: "instagram", label: t("automations.tabInstagram") },
          ]}
          value={tab}
          onValueChange={changeTab}
        />

        {tab === "flows" ? (
        <>
        {/* Stats bar */}
        {/* The three counts on their own only name a status. The second line
            says what the status does — a draft never runs, a paused one has
            stopped — which is the question the number actually raises. */}
        {/* The meter under each count is that status's share of the whole
            set, which is the comparison the three numbers are really asking
            for — nine drafts means something different next to two
            automations than next to ninety. */}
        {automations.length > 0 ? (
        <CardCarousel stats label={t("carousel.stats")}>
          <div className="mb-6 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
            <div className="min-w-[220px] flex-1">
              <KpiCard
                icon={PlayIcon}
                label={t("automations.active")}
                sub={t(counts.active > 0 ? "automations.activeSub" : "automations.activeSubNone")}
                value={counts.active}
                visual={<KpiBars ratio={share(counts.active)} tone="positive" />}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <KpiCard
                icon={PauseIcon}
                label={t("automations.paused")}
                sub={t(counts.paused > 0 ? "automations.pausedSub" : "automations.pausedSubNone")}
                value={counts.paused}
                visual={<KpiBars ratio={share(counts.paused)} tone="warning" />}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <KpiCard
                icon={AlertCircleIcon}
                label={t("automations.drafts")}
                sub={t(counts.draft > 0 ? "automations.draftsSub" : "automations.draftsSubNone")}
                value={counts.draft}
                visual={<KpiBars ratio={share(counts.draft)} />}
              />
            </div>
          </div>
        </CardCarousel>
        ) : null}

        {/* Automation list */}
        <div className="space-y-3">
          {sorted.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={ZapIcon} size={20} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium">{t("automations.noResults")}</p>
                <p className="max-w-xs text-xs text-muted-foreground">{t("automations.noResultsHint")}</p>
              </div>
            </Card>
          ) : (
            sorted.map((auto) => {
            const TriggerIcon = TRIGGER_ICONS[auto.trigger];
            const blanks = countAutomationBlanks(auto.steps);
            return (
              <Card key={auto.id} className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
                <div className="flex flex-col">
                  <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
                    <CardHeader>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => router.push(`/automations/${auto.id}`)}
                            aria-label={t("automations.openFlow")}
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)] transition-colors hover:text-foreground"
                          >
                            <HugeiconsIcon icon={TriggerIcon} size={16} strokeWidth={1.75} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t(TRIGGER_LABELS[auto.trigger])}</TooltipContent>
                      </Tooltip>
                      <button
                        onClick={() => router.push(`/automations/${auto.id}`)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <CardTitle>{auto.name}</CardTitle>
                          <StatusBadge status={auto.status} />
                        </div>
                        <CardDescription>{auto.description}</CardDescription>
                      </button>
                    </CardHeader>

                    <CardSeparator />

                    {/* Trigger info */}
                    <div className="flex flex-wrap items-center gap-4 px-5 py-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <HugeiconsIcon icon={ZapIcon} size={14} strokeWidth={1.75} />
                        {t(TRIGGER_LABELS[auto.trigger])}
                        {auto.triggerValue ? (
                          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs shadow-[var(--shadow-inset)]">
                            {auto.triggerValue}
                          </code>
                        ) : null}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.75} />
                        {auto.responseCount} {t("automations.responses")}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        {auto.lastTriggeredAt
                          ? t("automations.lastTrigger", { time: relativeTime(auto.lastTriggeredAt) })
                          : t("automations.neverTriggered")}
                      </span>
                      <LastRunChip run={lastRuns[auto.id]} />
                      {blanks > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-[color:var(--status-pending-fg)]">
                          <HugeiconsIcon icon={AlertCircleIcon} size={14} strokeWidth={1.75} />
                          {t("automations.blanks", { count: blanks })}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5">
                        {t("automations.channel")}:
                        {auto.channel === "all" ? (
                          <span className="font-medium">{t("automations.allChannels")}</span>
                        ) : (
                          <ChannelBadge channel={auto.channel} />
                        )}
                      </span>
                    </div>

                    {/* Workflow steps preview */}
                    {auto.steps && auto.steps.length > 0 ? (
                      <CardSeparator />
                    ) : null}
                    {auto.steps && auto.steps.length > 0 ? (
                      <div className="px-5 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <HugeiconsIcon icon={GitBranchIcon} size={14} strokeWidth={1.75} />
                          <span className="font-medium">{t("automations.workflow")}</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {auto.steps.map((step, i) => {
                              const StepIcon = STEP_ICONS[step.type];
                              return (
                                <span key={step.id} className="inline-flex items-center gap-1">
                                  {i > 0 ? (
                                    <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} className="text-muted-foreground" />
                                  ) : null}
                                   <CategoryBadge hue={STEP_HUES[step.type]}>
                                     <HugeiconsIcon icon={StepIcon} size={12} strokeWidth={1.75} aria-hidden="true" />
                                     {t(STEP_LABEL_KEYS[step.type])}
                                   </CategoryBadge>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Action bar — below inner border, no separator */}
                  <div className="flex items-center justify-end gap-1 px-2 pt-2 pb-0.5">
                    <RowAction
                      icon={GitBranchIcon}
                      label={t("automations.openFlow")}
                      onClick={() => router.push(`/automations/${auto.id}`)}
                    />
                    <RowAction
                      icon={PencilEdit01Icon}
                      label={t("automations.edit")}
                      onClick={() => handleEdit(auto)}
                    />
                    <RowAction
                      icon={auto.status === "active" ? PauseIcon : PlayIcon}
                      label={auto.status === "active" ? t("automations.pause") : t("automations.activate")}
                      disabled={auto.status === "draft" || (auto.status === "paused" && blanks > 0)}
                      disabledLabel={t(blanks > 0 ? "automations.blanksBlocked" : "automations.needsSteps")}
                      onClick={() => handleToggle(auto.id)}
                    />
                    <RowAction
                      icon={CopyIcon}
                      label={t("automations.duplicate")}
                      onClick={() => handleDuplicate(auto)}
                    />
                    <RowAction
                      icon={Download01Icon}
                      label={t("automations.exportN8n")}
                      onClick={() => handleExport(auto)}
                    />
                    <RowAction
                      icon={Delete01Icon}
                      label={t("automations.delete")}
                      destructive
                      onClick={() => void handleDelete(auto.id)}
                    />
                  </div>
                </div>
              </Card>
            );
          })
          )}
        </div>

        <AutomationTemplates
          usingId={usingTemplate}
          onUse={(template) => void handleUseTemplate(template)}
          onImport={() => fileInputRef.current?.click()}
        />
        </>
        ) : (
          <InstagramCommentAutomations />
        )}

        <Dialog
          open={importing !== null}
          onOpenChange={(open) => {
            if (!open && !importCreating) setImporting(null);
          }}
        >
          {importing ? (
            <N8nImportDialog
              // A second file must not open holding the first one's name.
              key={importing.fileName}
              fileName={importing.fileName}
              preview={importing.preview}
              creating={importCreating}
              onConfirm={(name) => void handleConfirmImport(name)}
            />
          ) : null}
        </Dialog>
        </div>
        </Skeleton>
    </PageContainer>
  );
}

/** One automation's most recent run, as /api/automations reports it. */
type LastRun = {
  readonly status: "running" | "waiting" | "completed" | "failed" | "handed_off";
  readonly step: number;
  readonly totalSteps: number;
  readonly resumeAt?: string;
  readonly terminalReason?: string;
  readonly at: string;
};

/**
 * What the flow actually did last time, beside how often it fired.
 *
 * `responseCount` counts firings, which is not the same question. A run that
 * paused on a `wait`, one that stopped because a condition could not be read,
 * and one that ran to the end all incremented it identically — so the page
 * could say an automation had fired two hundred times without ever saying that
 * none of them finished.
 */
function LastRunChip({ run }: { readonly run: LastRun | undefined }) {
  const t = useT();
  if (!run) return null;

  const tone =
    run.status === "completed"
      ? "text-emerald-600 dark:text-emerald-400"
      : run.status === "failed"
        ? "text-destructive"
        : "text-muted-foreground";

  const label =
    run.status === "completed"
      ? t("automations.runCompleted")
      : run.status === "failed"
        ? t("automations.runFailed", { step: String(run.step), total: String(run.totalSteps) })
        : run.status === "waiting"
          ? t("automations.runWaiting", { time: run.resumeAt ? relativeTime(run.resumeAt) : "" })
          : run.status === "handed_off"
            ? t("automations.runHandedOff")
            : t("automations.runRunning");

  return (
    <span className={cn("inline-flex items-center gap-1.5", tone)} title={run.terminalReason}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          run.status === "completed"
            ? "bg-emerald-500"
            : run.status === "failed"
              ? "bg-destructive"
              : "bg-muted-foreground/50",
        )}
      />
      {label}
    </span>
  );
}
