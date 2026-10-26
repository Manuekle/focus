"use client";

import "../product.css";
import { PipelineSkeleton } from "./page-skeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Coins01Icon,
  Download01Icon,
  DragDropIcon,
  Loading03Icon,
  PiggyBankIcon,
  SearchIcon,
  Target01Icon,
  ChartHistogramIcon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "../../_components/dashboard-card";
import { KpiBars, KpiCard, KpiSparkline } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { AnimatedNumber, ChartPeriod, ChartSelector, RankedBars, TimeSeries } from "../../_components/chart";
import chartStyles from "../../_components/charts/tiles.module.css";
import { DEAL_COLUMNS, DEAL_THEME, DealBoard, q as dealQ, type GroupedDeals } from "./_components/deal-board";
import { DealDialog } from "./_components/deal-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ai-elements/skeleton";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { ActionSwapText } from "@/components/motion/action-swap";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { csvCell, csvFile } from "@/lib/csv-export";
import {
  OPEN_STAGES,
  averageWonValue,
  byStage,
  formatMoney,
  isOverdue,
  isStale,
  pipelineTotals,
  winRate,
  wonBySource,
} from "@/lib/deals";
import { useI18n } from "@/lib/i18n/provider";
import { countByDay } from "@/lib/chart-data";
import { usePolling } from "@/lib/use-polling";
import type { Contact, Deal, DealStage } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function PipelinePage() {
  const { locale, t } = useI18n();
  const reduced = useReducedMotion();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [search, setSearch] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [attentionFilter, setAttentionFilter] = useState<"all" | "attention">("all");
  const [view, setView] = useState<"kanban" | "list" | "analytics">("kanban");
  const [dragActive, setDragActive] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  /** Part of the dialog's key: `editing?.id ?? "new"` is constant for every
   *  new deal, so the second one opened would still hold the first's title. */
  const [dialogNonce, setDialogNonce] = useState(0);
  const [trendDays, setTrendDays] = useState(14);

  /** The list as it stands right now, for rolling an optimistic move back. */
  const dealsRef = useRef<Deal[]>(deals);
  dealsRef.current = deals;

  /** Polling stands down for the length of a drag and of the write that
   *  follows it — same reason as the CRM board: a refetch answering with the
   *  pre-move stage would snap the card back to the column it just left. */
  const isDraggingRef = useRef(false);
  const movesInFlight = useRef(0);

  const load = useCallback(async () => {
    const [dealResult, contactResult] = await Promise.all([
      fetchJson<{ deals: Deal[] }>("/api/deals", t),
      fetchJson<{ contacts: Contact[] }>("/api/contacts", t),
    ]);
    if (isDraggingRef.current) return dealResult.ok && contactResult.ok;
    setIsLoading(false);
    if (!dealResult.ok) {
      setError(dealResult.error);
      return false;
    }
    setError(null);
    setDeals(dealResult.data.deals);
    if (contactResult.ok) setContacts(contactResult.data.contacts ?? []);
    return true;
  }, [t]);

  usePolling(() => {
    if (isDraggingRef.current || movesInFlight.current > 0) return;
    return load();
  }, 30_000);
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    // El GET local resuelve en milisegundos y el spin no llegaba a verse:
    // duración mínima para que cada clic reproduzca la animación completa.
    await Promise.all([load(), new Promise((resolve) => setTimeout(resolve, 800))]);
    setIsRefreshing(false);
  }, [load]);

  // ── Derived ──────────────────────────────────────────────────────

  /** One `now` per render rather than one per card: `isStale` called in a loop
   *  against a fresh `Date` each time can put two cards on opposite sides of a
   *  boundary within the same paint. Refreshed per `deals` change rather than
   *  per render so the staleness flags can't flip under a steady list. */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` intentionally refreshes when `deals` changes; the memo body needs no deal value
  const now = useMemo(() => new Date(), [deals]);

  const contactName = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact.name])),
    [contacts],
  );

  const currencies = useMemo(
    () => [...new Set(deals.map((deal) => deal.currency).filter(Boolean))].sort(),
    [deals],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return deals.filter((deal) => {
      if (currencyFilter !== "all" && deal.currency !== currencyFilter) return false;
      if (attentionFilter === "attention" && !(isOverdue(deal, now) || isStale(deal, now))) {
        return false;
      }
      if (!query) return true;
      const name = contactName.get(deal.contactId)?.toLowerCase() ?? "";
      return (
        deal.title.toLowerCase().includes(query) ||
        name.includes(query) ||
        deal.notes?.toLowerCase().includes(query)
      );
    });
  }, [deals, search, currencyFilter, attentionFilter, now, contactName]);

  const grouped = useMemo(() => {
    const groups = byStage(filtered);
    return groups as GroupedDeals;
  }, [filtered]);

  const totals = useMemo(() => pipelineTotals(filtered), [filtered]);
  /** The analysis cards plot one currency — mixing them into a single ranking
   *  would compare an amount in pesos against one in dollars. `pipelineTotals`
   *  already leads with the currency carrying the most. */
  const lead = totals[0];

  const scoped = useMemo(
    () => (lead ? filtered.filter((deal) => deal.currency === lead.currency) : filtered),
    [filtered, lead],
  );
  const rate = useMemo(() => winRate(scoped), [scoped]);
  const ticket = useMemo(
    () => (lead ? averageWonValue(filtered, lead.currency) : undefined),
    [filtered, lead],
  );
  const wonTrend = useMemo(
    () =>
      countByDay(
        scoped.filter((deal) => deal.stage === "won").map((deal) => deal.closedAt ?? deal.updatedAt),
        { locale, days: trendDays },
      ),
    [scoped, locale, trendDays],
  );

  const attention = useMemo(
    () => deals.filter((deal) => isOverdue(deal, now) || isStale(deal, now)).length,
    [deals, now],
  );

  // ── Actions ──────────────────────────────────────────────────────

  /** Optimistic: the card lands in the column it was dropped on, and only
   *  rolls back if the write actually fails. */
  const move = useCallback(async (id: string, stage: DealStage) => {
    const previous = dealsRef.current;
    const current = previous.find((deal) => deal.id === id);
    if (!current || current.stage === stage) return;
    setDeals(previous.map((deal) => (deal.id === id ? { ...deal, stage } : deal)));
    movesInFlight.current += 1;
    try {
      const result = await fetchJson<{ deal: Deal }>(`/api/deals/${id}`, t, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!result.ok) {
        setDeals(previous);
        setError(result.error);
        toast({
          title: t("common.somethingWentWrong"),
          description: t("common.somethingWentWrongDescription"),
          status: "error",
        });
        return;
      }
      setDeals((items) => items.map((deal) => (deal.id === id ? result.data.deal : deal)));
    } finally {
      movesInFlight.current -= 1;
    }
  }, [t, toast]);

  const remove = useCallback(async (deal: Deal) => {
    if (!(await confirm({ title: t("pipeline.confirmDelete") }))) return;
    const result = await fetchJson(`/api/deals/${deal.id}`, t, { method: "DELETE" });
    if (!result.ok) {
      setError(result.error);
      toast({
        title: t("common.somethingWentWrong"),
        description: t("common.somethingWentWrongDescription"),
        status: "error",
      });
    } else {
      setDeals((items) => items.filter((item) => item.id !== deal.id));
      toast({ title: t("common.deleted"), description: t("common.deletedDescription"), status: "success" });
    }
  }, [t, confirm, toast]);

  const openDialog = (deal: Deal | null) => {
    setEditing(deal);
    setDialogNonce((n) => n + 1);
    setDialogOpen(true);
  };

  /** Stable identities for everything the board takes. The board re-renders on
   *  every pointer move of a drag, and an inline prop here would rebuild its
   *  drag handlers each frame. */
  const handleMove = useCallback((id: string, stage: DealStage) => {
    void move(id, stage);
  }, [move]);
  const handleDelete = useCallback((deal: Deal) => void remove(deal), [remove]);
  const handleEdit = useCallback((deal: Deal) => openDialog(deal), []);
  const handleDragActive = useCallback((active: boolean) => {
    isDraggingRef.current = active;
    setDragActive(active);
  }, []);

  const exportCSV = () => {
    const header = "id,title,contact,stage,value,currency,expectedCloseAt,createdAt\r\n";
    const blob = csvFile(
      header,
      filtered.map((deal) =>
        [
          deal.id,
          deal.title,
          contactName.get(deal.contactId) ?? "",
          deal.stage,
          deal.value,
          deal.currency,
          deal.expectedCloseAt,
          deal.createdAt,
        ].map(csvCell),
      ),
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const total = filtered.length;
  const noResults = total === 0 && deals.length > 0;

  return (
    <PageContainer
      banner={<ErrorBanner layout="strip" error={error} onDismiss={() => setError(null)} />}
      maxWidth="max-w-[1400px]"
      title={t("pipeline.title")}
      description={t("pipeline.subtitle")}
      meta={attention > 0 ? (
        <span className="pill pill-sm inline-flex shrink-0 items-center gap-1 text-[var(--status-review-fg)]">
          <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
          {t("pipeline.needAttention", { count: attention })}
        </span>
      ) : null}
      actions={
        <>
          <Button variant="outline" size="sm" aria-label={t("leads.exportCsv")} onClick={exportCSV} disabled={dragActive || total === 0}>
            <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">{t("leads.exportCsv")}</span>
          </Button>
          <Button variant="outline" size="sm" aria-label={t("common.refresh")} onClick={() => void refresh()} disabled={isRefreshing || dragActive}>
            <HugeiconsIcon
              icon={Loading03Icon}
              size={16}
              strokeWidth={1.75}
              className={isRefreshing ? "animate-spin" : undefined}
            />
            <span className="hidden sm:inline">
              <ActionSwapText value={isRefreshing ? "refreshing" : "idle"}>
                {isRefreshing ? t("crm.refreshing") : t("common.refresh")}
              </ActionSwapText>
            </span>
          </Button>
          <Button size="sm" onClick={() => openDialog(null)} disabled={dragActive || contacts.length === 0}>
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
            {t("pipeline.new")}
          </Button>
        </>
      }
    >
      {confirmDialog}
      <Skeleton className="min-h-[500px]" isLoading={isLoading} skeleton={<PipelineSkeleton />}>
        <div className="content-enter">
          {/* Pipeline bar — where the pipeline actually sits, in one glance. */}
          {total > 0 ? (
            <div className="mb-5 flex h-1.5 gap-1 overflow-hidden rounded-full">
              {DEAL_COLUMNS.map((stage) => {
                const count = grouped[stage].length;
                if (count === 0) return null;
                return (
                  <Tooltip key={stage}>
                    <TooltipTrigger asChild>
                      <motion.span
                        className={cn("block h-full rounded-full", DEAL_THEME[stage].bar)}
                        initial={false}
                        animate={{ flexGrow: count }}
                        transition={
                          reduced
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 300, damping: 30, mass: 0.7 }
                        }
                        style={{ flexBasis: 0 }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t(`pipeline.stage.${stage}`)} · {count}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <fieldset
              disabled={dragActive}
              aria-label={locale === "es" ? "Vista del pipeline" : "Pipeline view"}
              className="min-w-0 shrink-0 disabled:opacity-50"
            >
              <SlidingTabs
                tabs={[
                  { id: "kanban", label: locale === "es" ? "Tablero" : "Board" },
                  { id: "list", label: locale === "es" ? "Lista" : "List" },
                  { id: "analytics", label: locale === "es" ? "Estadísticas" : "Analytics" },
                ]}
                value={view}
                onValueChange={(mode) => {
                  if (!dragActive && (mode === "kanban" || mode === "list" || mode === "analytics")) {
                    setView(mode);
                  }
                }}
              />
            </fieldset>
            <div className="relative min-w-[200px] flex-1">
              <HugeiconsIcon
                icon={SearchIcon}
                size={16}
                strokeWidth={1.75}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label={locale === "es" ? "Buscar oportunidad" : "Search opportunities"}
                value={search}
                disabled={dragActive}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={locale === "es" ? "Buscar oportunidades…" : "Search deals…"}
                className={cn("pl-9", search && "pr-9")}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  disabled={dragActive}
                  aria-label={t("crm.clearSearch")}
                  className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
                </button>
              ) : null}
            </div>
            <Select value={currencyFilter} onValueChange={setCurrencyFilter} disabled={dragActive}>
              <SelectTrigger aria-label={t("pipeline.field.currency")} className="w-full sm:w-[184px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === "es" ? "Todas las monedas" : "All currencies"}</SelectItem>
                {currencies.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={attentionFilter}
              onValueChange={(mode) => setAttentionFilter(mode as "all" | "attention")}
              disabled={dragActive}
            >
              <SelectTrigger
                aria-label={locale === "es" ? "Filtrar por atención" : "Filter by attention"}
                className="w-full sm:w-[212px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === "es" ? "Todas las oportunidades" : "All opportunities"}</SelectItem>
                <SelectItem value="attention">
                  {locale === "es" ? "Necesitan atención" : "Need attention"}
                </SelectItem>
              </SelectContent>
            </Select>
            {view !== "analytics" && total > 0 ? (
              <p className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                {t("crm.dragHint")}
                <HugeiconsIcon icon={DragDropIcon} size={14} strokeWidth={1.75} />
              </p>
            ) : null}
          </div>

          {/* Mismo inset que el scroller del board (dealQ(8)): los tres tabs
              arrancan en el mismo px y no hay salto al cambiar de vista. */}
          <div className="w-full min-w-0" style={{ containerType: "inline-size" }}>
            {/* An empty board is not drawn under the empty state: seven
                "nothing here" columns above a "no opportunities yet" said the
                same thing twice. */}
            {view !== "analytics" && total > 0 ? (
              <DealBoard
                view={view}
                grouped={grouped}
                contactName={contactName}
                now={now}
                locale={locale}
                onMove={handleMove}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onDragActiveChange={handleDragActive}
              />
            ) : null}

            {view !== "analytics" && total === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={PiggyBankIcon} size={20} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium">{t("pipeline.empty")}</p>
                <p className="max-w-[42ch] text-xs leading-relaxed text-muted-foreground">
                  {noResults
                    ? t("leads.noResults")
                    : contacts.length > 0
                      ? t("pipeline.emptyHint")
                      : t("pipeline.emptyNoContacts")}
                </p>
                {contacts.length > 0 && !noResults ? (
                  <Button className="mt-1" size="sm" onClick={() => openDialog(null)}>
                    <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={1.75} />
                    {t("pipeline.new")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {view === "analytics" ? (
              <section
                aria-label={locale === "es" ? "Estadísticas" : "Analytics"}
                style={{ padding: dealQ(8) }}
              >
                {lead ? (
                  <>
                    <CardCarousel stats label={t("carousel.stats")}>
                      <div className="mb-4 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
                        <div className="min-w-[200px] flex-1">
                          <KpiCard
                            icon={PiggyBankIcon}
                            label={t("pipeline.kpi.open")}
                            value={formatMoney(lead.open, lead.currency, locale)}
                            sub={t("pipeline.kpi.openHint", { count: lead.openCount })}
                          />
                        </div>
                        <div className="min-w-[200px] flex-1">
                          <KpiCard
                            icon={ChartHistogramIcon}
                            label={t("pipeline.kpi.forecast")}
                            value={formatMoney(lead.forecast, lead.currency, locale)}
                            sub={t("pipeline.kpi.forecastHint")}
                            visual={
                              <KpiBars
                                ratio={lead.open > 0 ? lead.forecast / lead.open : 0}
                                tone="neutral"
                              />
                            }
                          />
                        </div>
                        <div className="min-w-[200px] flex-1">
                          <KpiCard
                            icon={CheckmarkCircle02Icon}
                            label={t("pipeline.kpi.won")}
                            value={formatMoney(lead.won, lead.currency, locale)}
                            sub={t("pipeline.kpi.wonHint", { count: lead.wonCount })}
                            visual={
                              <KpiBars
                                ratio={rate ?? 0}
                                tone="positive"
                              />
                            }
                          />
                        </div>
                        <div className="min-w-[200px] flex-1">
                          <KpiCard
                            icon={Target01Icon}
                            label={t("pipeline.kpi.winRate")}
                            value={rate === undefined ? "—" : `${Math.round(rate * 100)}%`}
                            sub={
                              ticket === undefined
                                ? t("pipeline.kpi.winRateHint")
                                : t("pipeline.kpi.avgTicket", {
                                    value: formatMoney(ticket, lead.currency, locale),
                                  })
                            }
                            visual={<KpiSparkline points={wonTrend.map((day) => day.value)} tone="positive" />}
                          />
                        </div>
                      </div>
                    </CardCarousel>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <div className="min-w-0 flex-1">
                            <CardTitle>
                              {locale === "es" ? "Cierres por día" : "Won per day"}
                            </CardTitle>
                            <CardDescription className="truncate leading-[18px]">
                              <ChartPeriod value={String(trendDays)}>
                                {trendDays} {locale === "es" ? "días" : "days"}
                              </ChartPeriod>
                            </CardDescription>
                          </div>
                        </CardHeader>
                        <CardSeparator />
                        <CardBody>
                          <div className={chartStyles.root}>
                            <div className={chartStyles.stackSummary}>
                              <AnimatedNumber
                                className={chartStyles.stackTotal}
                                value={wonTrend.reduce((sum, day) => sum + day.value, 0)}
                              />
                              <span className={chartStyles.stackCaption}>
                                {locale === "es" ? "oportunidades ganadas" : "deals won"}
                              </span>
                            </div>
                            <div className={cn(chartStyles.stackLegend, "items-center [&>div]:mt-0")}>
                              <ChartSelector
                                label={t("common.filterByPeriod")}
                                value={String(trendDays)}
                                options={[7, 14, 30, 90].map((days) => ({
                                  value: String(days),
                                  label: `${days}D`,
                                }))}
                                onChange={(value) => setTrendDays(Number(value))}
                              />
                            </div>
                            <TimeSeries
                              data={wonTrend}
                              emptyLabel={t("pipeline.shape.empty")}
                              formatValue={(point) => (
                                <span className="tabular-nums">
                                  {point.label} ·{" "}
                                  {locale === "es"
                                    ? `${point.value} ganadas`
                                    : `${point.value} won`}
                                </span>
                              )}
                            />
                          </div>
                        </CardBody>
                      </Card>
                      <Card>
                        <CardHeader>
                          <div className="min-w-0 flex-1">
                            <CardTitle>{t("pipeline.shape.title")}</CardTitle>
                            <CardDescription className="truncate leading-[18px]">
                              {t("pipeline.shape.description")}
                            </CardDescription>
                          </div>
                        </CardHeader>
                        <CardSeparator />
                        <CardBody>
                          <RankedBars
                            bars={OPEN_STAGES.map((stage) => {
                              const value = grouped[stage]
                                .filter((deal) => deal.currency === lead.currency)
                                .reduce((sum, deal) => sum + deal.value, 0);
                              return {
                                key: stage,
                                label: t(`pipeline.stage.${stage}`),
                                value,
                                formatted: formatMoney(value, lead.currency, locale),
                              };
                            })}
                            emptyLabel={t("pipeline.shape.empty")}
                            limit={OPEN_STAGES.length}
                          />
                        </CardBody>
                      </Card>
                    </div>
                    <Card className="mt-4">
                      <CardHeader>
                        <div className="min-w-0 flex-1">
                          <CardTitle>{t("pipeline.sources.title")}</CardTitle>
                          <CardDescription className="truncate leading-[18px]">
                            {t("pipeline.sources.description")}
                          </CardDescription>
                        </div>
                        <HugeiconsIcon
                          icon={Coins01Icon}
                          size={16}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground"
                        />
                      </CardHeader>
                      <CardSeparator />
                      <CardBody>
                        <RankedBars
                          bars={wonBySource(filtered, lead.currency).map((row) => ({
                            key: row.source,
                            label: row.source,
                            value: row.value,
                            formatted: formatMoney(row.value, lead.currency, locale),
                            tone: "positive" as const,
                          }))}
                          emptyLabel={t("pipeline.sources.empty")}
                        />
                      </CardBody>
                    </Card>
                  </>
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    {t("pipeline.shape.empty")}
                  </p>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </Skeleton>

      {dialogOpen ? (
        <DealDialog
          key={`${editing?.id ?? "new"}-${dialogNonce}`}
          open={dialogOpen}
          editing={editing}
          contacts={contacts}
          deals={deals}
          onClose={() => setDialogOpen(false)}
          onSaved={(deal) =>
            setDeals((current) =>
              current.some((item) => item.id === deal.id)
                ? current.map((item) => (item.id === deal.id ? deal : item))
                : [deal, ...current],
            )
          }
        />
      ) : null}
    </PageContainer>
  );
}
