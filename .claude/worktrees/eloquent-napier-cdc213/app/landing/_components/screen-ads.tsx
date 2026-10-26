"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  Coins01Icon,
  Megaphone01Icon,
  MoreHorizontalIcon,
  MouseLeftClick01Icon,
  ScanSearchIcon as ScanSearchAreaIcon,
  SearchIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "react";
import {
  CampaignRow,
  LeadRow,
  formatObjective,
  formatStatus,
} from "@/app/_components/ads-rows";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardSeparator,
  CardTitle,
} from "@/app/_components/dashboard-card";
import { CardCarousel } from "@/app/_components/card-carousel";
import { RankedBars } from "@/app/_components/chart";
import { KpiBars, KpiCard, KpiSplit } from "@/app/_components/kpi-card";
import { Pagination } from "@/components/ai-elements/pagination";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n/provider";
import { AppChrome } from "./screen-chrome";

/**
 * The Meta Ads page, rendered from the page's own rows.
 *
 * `CampaignRow`, `LeadRow`, `formatObjective` and `formatStatus` are imported from
 * `app/_components/ads-rows.tsx` — the same module `app/(app)/ads/page.tsx` renders.
 * The demo data below is therefore Meta's own vocabulary, enum names and minor
 * units included, and it comes out the other side as «Ventas · Activa» here
 * for exactly the reason it does in the product. A redesign of the row now
 * lands on both surfaces or on neither.
 */

// ── Formatting ──────────────────────────────────────────────────────

const LOCALE = "es-AR";

function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** `formatBudget` from the page: Meta returns budgets in minor units. */
function formatBudget(minorUnits: number): string {
  return `$${(minorUnits / 100).toLocaleString(LOCALE)}`;
}

// ── Data ────────────────────────────────────────────────────────────

type Campaign = {
  readonly budgetRemaining: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly cpm: number;
  readonly dailyBudget: number;
  readonly id: string;
  readonly impressions: number;
  readonly name: string;
  /** Meta's enum, as the API sends it — the row humanises it. */
  readonly objective: string;
  readonly reach: number;
  readonly spend: number;
  readonly status: string;
};

/**
 * Four campaigns, not six. The bottom of every screen on this page dissolves
 * into the veil; a list long enough to run under it spends its last two rows
 * being half-legible, which reads as a screenshot that was cropped badly
 * rather than as a page that continues.
 */
function useCampaigns(t: (key: string) => string): readonly Campaign[] {
  return [
    {
      budgetRemaining: 218400,
      clicks: 4128,
      conversions: 186,
      cpm: 9.9,
      dailyBudget: 600000,
      id: "c-1",
      impressions: 184212,
      name: t("landing.demo.ads.campaign1"),
      objective: "OUTCOME_SALES",
      reach: 76840,
      spend: 1824,
      status: "ACTIVE",
    },
    {
      budgetRemaining: 142000,
      clicks: 2210,
      conversions: 41,
      cpm: 10.0,
      dailyBudget: 350000,
      id: "c-2",
      impressions: 96740,
      name: t("landing.demo.ads.campaign2"),
      objective: "OUTCOME_TRAFFIC",
      reach: 41120,
      spend: 967.5,
      status: "ACTIVE",
    },
    {
      budgetRemaining: 96500,
      clicks: 1488,
      conversions: 97,
      cpm: 9.27,
      dailyBudget: 250000,
      id: "c-4",
      impressions: 62880,
      name: t("landing.demo.ads.campaign3"),
      objective: "OUTCOME_SALES",
      reach: 18960,
      spend: 583,
      status: "ACTIVE",
    },
    {
      budgetRemaining: 58000,
      clicks: 612,
      conversions: 0,
      cpm: 10.0,
      dailyBudget: 180000,
      id: "c-3",
      impressions: 41200,
      name: t("landing.demo.ads.campaign4"),
      objective: "OUTCOME_AWARENESS",
      reach: 24380,
      spend: 412,
      status: "PAUSED",
    },
  ];
}

type Tab = "campaigns" | "leads";

/** Static stand-ins for the leads tab: the figure has no API to read them from. */
type MockLead = {
  readonly contact: string;
  readonly date: string;
  readonly fields: readonly { readonly name: string; readonly value: string }[];
  readonly form: string;
  readonly id: string;
  readonly name: string;
  readonly time: string;
};

const LEADS: readonly MockLead[] = [
  {
    contact: "lucia@example.com",
    date: "12/02/2026, 10:24",
    fields: [
      { name: "full_name", value: "Lucía Fernández" },
      { name: "email", value: "lucia@example.com" },
      { name: "phone_number", value: "+54 9 11 5555-0123" },
    ],
    form: "Formulario web",
    id: "l-1",
    name: "Lucía Fernández",
    time: "12/02/2026",
  },
  {
    contact: "martin@example.com",
    date: "11/02/2026, 18:07",
    fields: [
      { name: "full_name", value: "Martín Gómez" },
      { name: "email", value: "martin@example.com" },
      { name: "phone_number", value: "+54 9 11 5555-0198" },
    ],
    form: "Lead Ad — Promo febrero",
    id: "l-2",
    name: "Martín Gómez",
    time: "11/02/2026",
  },
  {
    contact: "+54 9 11 5555-0147",
    date: "10/02/2026, 09:52",
    fields: [
      { name: "full_name", value: "Sofía Ruiz" },
      { name: "phone_number", value: "+54 9 11 5555-0147" },
    ],
    form: "Formulario web",
    id: "l-3",
    name: "Sofía Ruiz",
    time: "10/02/2026",
  },
];

// ── Screen ──────────────────────────────────────────────────────────

export function AdsScreen() {
  const t = useT();
  const CAMPAIGNS = useCampaigns(t);
  const [tab, setTab] = useState<Tab>("campaigns");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /** The page opens a campaign on click; one is open here so the figure shows
   *  what a row holds instead of only showing that rows exist. */
  const [expandedId, setExpandedId] = useState<string | null>("c-1");

  const totals = useMemo(
    () =>
      CAMPAIGNS.reduce(
        (acc, campaign) => ({
          clicks: acc.clicks + campaign.clicks,
          impressions: acc.impressions + campaign.impressions,
          reach: acc.reach + campaign.reach,
          spend: acc.spend + campaign.spend,
        }),
        { clicks: 0, impressions: 0, reach: 0, spend: 0 },
      ),
    [CAMPAIGNS],
  );

  /** One metric, campaign by campaign, for the split bar under its total. */
  const split = (pick: (campaign: Campaign) => number) =>
    CAMPAIGNS.map((campaign) => ({ tone: "neutral" as const, value: pick(campaign) }));

  /** The daily ceiling the spend tile measures itself against, in major units. */
  const dailyBudgetTotal = CAMPAIGNS.reduce((sum, c) => sum + c.dailyBudget / 100, 0);

  /**
   * Spend per campaign, named.
   *
   * The tiles above already split each total across campaigns, but a split bar
   * has no labels — it shows that the spend is lopsided without saying which
   * campaign is eating it. This is the same data with the names attached, and
   * it is the one question the tiles cannot answer.
   */
  const spendByCampaign = useMemo(
    () =>
      CAMPAIGNS.map((campaign) => ({
        key: campaign.id,
        label: campaign.name,
        formatted: formatCurrency(campaign.spend),
        value: campaign.spend,
      })).filter((bar) => bar.value > 0),
    [CAMPAIGNS],
  );

  /** Same predicate as the page: name, objective or status contains the query. */
  const filteredCampaigns = useMemo(() => {
    if (!search.trim()) return CAMPAIGNS;
    const q = search.toLowerCase();
    return CAMPAIGNS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.objective.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q),
    );
  }, [CAMPAIGNS, search]);

  const filteredLeads = useMemo(() => {
    if (!search.trim()) return LEADS;
    const q = search.toLowerCase();
    return LEADS.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.contact.toLowerCase().includes(q) ||
        l.form.toLowerCase().includes(q),
    );
  }, [search]);

  // Both tabs page through the same control, so the slice is derived from
  // whichever list is on screen. Clamped on render — switching tabs or typing a
  // search can shorten the list under a page that no longer exists.
  const rows = tab === "campaigns" ? filteredCampaigns : filteredLeads;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleCampaigns = filteredCampaigns.slice(pageStart, pageStart + pageSize);
  const visibleLeads = filteredLeads.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, tab, datePreset]);

  const labels = {
    clicks: t("ads.clicks"),
    conversions: t("ads.conversions"),
    cpc: t("ads.costPerClick"),
    cpm: t("ads.cpm"),
    ctr: t("ads.ctr"),
    impressions: t("ads.impressions"),
    spend: t("ads.spend"),
  };

  const leadLabels = { date: t("ads.date"), form: t("ads.leadForm") };

  return (
    <AppChrome
      active="/ads"
      title={t("ads.title")}
      subtitle={t("ads.subtitle")}
      actions={
        <div className="flex shrink-0 items-center gap-2">
          <Select value={datePreset} onValueChange={setDatePreset}>
            <SelectTrigger aria-label={t("common.filterByPeriod")} className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("ads.dateToday")}</SelectItem>
              <SelectItem value="yesterday">{t("ads.dateYesterday")}</SelectItem>
              <SelectItem value="last_7d">{t("ads.dateLast7")}</SelectItem>
              <SelectItem value="last_14d">{t("ads.dateLast14")}</SelectItem>
              <SelectItem value="last_30d">{t("ads.dateLast30")}</SelectItem>
              <SelectItem value="this_month">{t("ads.dateThisMonth")}</SelectItem>
              <SelectItem value="last_month">{t("ads.dateLastMonth")}</SelectItem>
            </SelectContent>
          </Select>
          {/* The page's New Campaign button, drawn but inert: same glyph, same
              label, same primary variant — purely decorative, so it stays out
              of the tab order and the accessibility tree. */}
          <Button aria-hidden="true" tabIndex={-1} type="button">
            <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={1.75} />
            {t("ads.newCampaign")}
          </Button>
        </div>
      }
    >
      {/* Tabs and search on one line, as the page has them. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <SlidingTabs
          value={tab}
          onValueChange={(next) => {
            setTab(next as Tab);
            setExpandedId(null);
          }}
          tabs={[
            { id: "campaigns", label: t("ads.tabCampaigns") },
            { id: "leads", label: t("ads.tabLeads") },
          ]}
        />
        <div className="relative w-full sm:w-64">
          <HugeiconsIcon
            icon={SearchIcon}
            size={16}
            strokeWidth={1.75}
            className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground"
          />
          <Input
            aria-label={tab === "campaigns" ? t("ads.searchCampaigns") : t("ads.searchLeads")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "campaigns" ? t("ads.searchCampaigns") : t("ads.searchLeads")}
            className="pl-9"
          />
        </div>
      </div>

      {/* KPI totals row (campaigns only). Four totals, four different pictures, exactly as the
          page draws them: where the impressions came from, how the clicks were
          distributed, how much of today's budget is gone, and how much of the
          impression count was a first look. `lp-kpi-row` keeps the landing's
          value-size rule; the flex tile layout inside is the page's own. */}
      {tab === "campaigns" && (
        <CardCarousel stats label="Estadísticas de campaña">
          <div
            className="lp-kpi-row mb-6 flex items-stretch gap-4"
            style={{ paddingInline: "2px" }}
          >
            <div className="min-w-[200px] flex-1">
              <KpiCard
                icon={ScanSearchAreaIcon}
                label={t("ads.impressions")}
                value={formatNumber(totals.impressions)}
                sub={t("ads.frequency", { value: (totals.impressions / totals.reach).toFixed(1) })}
                visual={<KpiSplit parts={split((c) => c.impressions)} />}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <KpiCard
                icon={MouseLeftClick01Icon}
                label={t("ads.clicks")}
                value={formatNumber(totals.clicks)}
                sub={t("ads.ctrSub", { value: ((totals.clicks / totals.impressions) * 100).toFixed(2) })}
                visual={<KpiSplit parts={split((c) => c.clicks)} />}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <KpiCard
                icon={Coins01Icon}
                label={t("ads.spend")}
                value={formatCurrency(totals.spend)}
                sub={t("ads.cpcSub", { value: formatCurrency(totals.spend / totals.clicks) })}
                visual={<KpiBars ratio={totals.spend / dailyBudgetTotal} />}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <KpiCard
                icon={UserGroupIcon}
                label={t("ads.reach")}
                value={formatNumber(totals.reach)}
                sub={t("ads.reachSub")}
                visual={<KpiBars ratio={totals.reach / totals.impressions} />}
              />
            </div>
          </div>
        </CardCarousel>
      )}

      {tab === "campaigns" && spendByCampaign.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <div className="min-w-0 flex-1">
              <CardTitle>{t("ads.byCampaignTitle")}</CardTitle>
              <CardDescription>{t("ads.byCampaignDescription")}</CardDescription>
            </div>
          </CardHeader>
          <CardSeparator />
          <CardBody>
            <RankedBars bars={spendByCampaign} emptyLabel={t("ads.byCampaignEmpty")} />
          </CardBody>
        </Card>
      )}

      {tab === "campaigns" && (
        <>
          {filteredCampaigns.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={Megaphone01Icon} size={20} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium">{t("ads.emptyCampaigns")}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {t("ads.emptyCampaignsHint")}
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {visibleCampaigns.map((campaign) => {
                const ctr =
                  campaign.impressions === 0 ? 0 : (campaign.clicks / campaign.impressions) * 100;
                const cpc = campaign.clicks === 0 ? 0 : campaign.spend / campaign.clicks;
                const spent = campaign.dailyBudget - campaign.budgetRemaining;

                return (
                  <CampaignRow
                    actions={
                      /* The page's pause/edit/delete menu, drawn closed and
                         inert: the same `...` button classes so the row ends
                         where the page's rows end. */
                      <button
                        aria-hidden="true"
                        tabIndex={-1}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        type="button"
                      >
                        <HugeiconsIcon icon={MoreHorizontalIcon} size={15} strokeWidth={2} />
                      </button>
                    }
                    expanded={expandedId === campaign.id}
                    key={campaign.id}
                    labels={labels}
                    onToggle={() => setExpandedId(expandedId === campaign.id ? null : campaign.id)}
                    view={{
                      budgetCaption: t("ads.budgetSpentOf", {
                        spent: formatBudget(spent),
                        total: formatBudget(campaign.dailyBudget),
                      }),
                      budgetLabel: t("ads.budgetDaily"),
                      budgetRatio: spent / campaign.dailyBudget,
                      budgetValue: formatBudget(campaign.dailyBudget),
                      clicks: formatNumber(campaign.clicks),
                      conversions: formatNumber(campaign.conversions),
                      cpc: formatCurrency(cpc),
                      cpm: formatCurrency(campaign.cpm),
                      ctr: `${ctr.toFixed(2)}%`,
                      impressions: formatNumber(campaign.impressions),
                      name: campaign.name,
                      objective: formatObjective(campaign.objective, t),
                      spend: formatCurrency(campaign.spend),
                      status: campaign.status,
                      statusLabel: formatStatus(campaign.status, t),
                    }}
                  />
                );
              })}
              {/* Same control as the page. Four rows fit one page, so the page
                  bar hides itself and only the rows-per-page tabs remain. */}
              <Pagination
                className="pt-3"
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                page={currentPage}
                pageCount={pageCount}
                pageSize={pageSize}
              />
            </div>
          )}
        </>
      )}

      {tab === "leads" && (
        <>
          {filteredLeads.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={Megaphone01Icon} size={20} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium">{t("ads.emptyLeads")}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {t("ads.emptyLeadsHint")}
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {visibleLeads.map((lead) => (
                <LeadRow
                  expanded={expandedId === lead.id}
                  key={lead.id}
                  labels={leadLabels}
                  onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
                  view={{
                    contact: lead.contact,
                    date: lead.date,
                    fields: lead.fields,
                    form: lead.form,
                    name: lead.name,
                    time: lead.time,
                  }}
                />
              ))}
              <Pagination
                className="pt-3"
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                page={currentPage}
                pageCount={pageCount}
                pageSize={pageSize}
              />
            </div>
          )}
        </>
      )}
    </AppChrome>
  );
}
