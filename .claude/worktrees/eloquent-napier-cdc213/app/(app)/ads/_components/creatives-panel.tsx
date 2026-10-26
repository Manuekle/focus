"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Image01Icon,
  Megaphone01Icon,
  SparklesIcon,
  TextIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "../../../_components/dashboard-card";
import { AdsMetric, AdsRow, AdsStatusDot, formatStatus } from "../../../_components/ads-rows";
import { ProductFigure } from "@/components/hairline/product-figure";
import { Pagination } from "@/components/ai-elements/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ScoreRing } from "@/components/ui/score-ring";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson, isApiError, type UiError } from "@/lib/api-error-message";
import { useFeature } from "@/lib/features-context";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AdReviewDrawer } from "./ad-review-drawer";
import { CompetitorsCard } from "./competitors-card";
import {
  Finding,
  GradeBreakdown,
  formatCurrency,
  formatPercent,
  isRiskyScore,
  type CreativeGrade,
} from "./creative-grade";

/**
 * The Creativos tab: every ad on the account, what it did, and what Jev reads
 * in it — and, on top, the two or three things that reading says about the
 * whole account.
 *
 * One button does the work. The tab opens on a plain read (Meta's numbers and
 * any grades already stored, no Jev call), and "Analizar" grades what is new.
 * Grades are stored per creative on the server, so a second visit is instant
 * and costs nothing.
 */

type CreativeRow = {
  readonly adId: string;
  readonly name: string;
  readonly status: string;
  readonly copy: {
    readonly primaryText: string;
    readonly headline: string;
    readonly cta: string;
    readonly kind: "video" | "image" | "carousel" | "text";
  };
  readonly thumbnailUrl: string | null;
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly results: number;
  readonly grade: CreativeGrade | null;
  readonly ungradable: boolean;
};

type FormatStat = {
  readonly format: string;
  readonly ads: number;
  readonly spend: number;
  readonly impressions: number;
  readonly results: number;
  readonly ctr: number | null;
  readonly costPerResult: number | null;
  readonly averageGrade: number;
};

type CreativesReport = {
  readonly graderReady: boolean;
  readonly rows: readonly CreativeRow[];
  readonly summary: {
    readonly graded: number;
    readonly averageGrade: number | null;
    readonly formats: readonly FormatStat[];
    readonly bestFormat: string | null;
    readonly bestFormatBy: "costPerResult" | "ctr" | null;
    readonly topAdId: string | null;
    readonly riskyAdIds: readonly string[];
  };
  readonly pending: number;
  readonly gradedNow: number;
};

const KIND_ICONS = {
  video: Video01Icon,
  image: Image01Icon,
  carousel: Image01Icon,
  text: TextIcon,
} as const;

export function CreativesPanel({ datePreset }: { readonly datePreset: string }) {
  const t = useT();
  const [report, setReport] = useState<CreativesReport | null>(null);
  // The period the report on screen was read for. Loading is derived from it
  // rather than flagged, so a period change shows the spinner without a state
  // write inside the effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== datePreset;
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const competitorsOn = useFeature("ads.competitors");

  const load = useCallback(async () => {
    const result = await fetchJson<CreativesReport>(
      `/api/ads/creatives?${new URLSearchParams({ date_preset: datePreset })}`,
      t,
    );
    if (!result.ok) {
      // The parent page owns "Meta isn't connected"; this panel only renders
      // once it is, so a not_configured here is a race worth staying quiet on.
      if (!(isApiError(result.error) && result.error.code === "not_configured")) setError(result.error);
      return;
    }
    setError(null);
    setReport(result.data);
  }, [datePreset, t]);

  useEffect(() => {
    void load().finally(() => setLoadedFor(datePreset));
  }, [load, datePreset]);

  const analyze = async () => {
    setAnalyzing(true);
    const result = await fetchJson<CreativesReport>("/api/ads/creatives", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date_preset: datePreset }),
    });
    setAnalyzing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReport(result.data);
  };

  const rows = useMemo(() => report?.rows ?? [], [report]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const byId = useMemo(() => new Map(rows.map((row) => [row.adId, row])), [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground text-sm">
        <Spinner />
        {t("ads.creatives.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdReviewDrawer onOpenChange={setReviewOpen} open={reviewOpen} ready={report?.graderReady ?? false} />
      <ErrorBanner error={error} onRetry={() => void load()} />

      {report && !report.graderReady ? <NeedsKey /> : null}

      {report && report.graderReady ? (
        <AnalyzeCard
          analyzing={analyzing}
          onAnalyze={() => void analyze()}
          onReview={() => setReviewOpen(true)}
          pending={report.pending}
          graded={report.summary.graded}
        />
      ) : null}

      {report && report.summary.graded > 0 ? (
        <Findings byId={byId} report={report} />
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={Megaphone01Icon} size={20} strokeWidth={1.75} />
            </div>
            <p className="font-medium text-sm">{t("ads.creatives.empty")}</p>
            <p className="max-w-sm text-muted-foreground text-xs leading-relaxed">{t("ads.creatives.emptyHint")}</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((row) => (
            <CreativeAdRow
              expanded={expandedId === row.adId}
              key={row.adId}
              onToggle={() => setExpandedId(expandedId === row.adId ? null : row.adId)}
              row={row}
            />
          ))}
          <Pagination
            className="pt-3"
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
          />
        </div>
      )}

      {/* After the owner's own rows, so their reading and their ads stay
          together and the comparison comes once both are on screen. */}
      {report && competitorsOn ? (
        <CompetitorsCard
          graderReady={report.graderReady}
          ownGrades={rows.flatMap((row) => (row.grade ? [row.grade] : []))}
        />
      ) : null}
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────

/** No TypeSafe key yet. The rows below still show Meta's numbers. */
function NeedsKey() {
  const t = useT();
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-5 py-8 text-center sm:flex-row sm:text-left">
        <ProductFigure className="h-24 w-32 shrink-0" kind="rack" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{t("ads.creatives.needsKeyTitle")}</p>
          <p className="mt-1 max-w-lg text-muted-foreground text-xs leading-relaxed">
            {t("ads.creatives.needsKeyBody")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/settings">{t("ads.creatives.needsKeyAction")}</Link>
        </Button>
      </div>
    </Card>
  );
}

function AnalyzeCard({
  analyzing,
  graded,
  onAnalyze,
  onReview,
  pending,
}: {
  readonly analyzing: boolean;
  readonly graded: number;
  readonly onAnalyze: () => void;
  readonly onReview: () => void;
  readonly pending: number;
}) {
  const t = useT();
  const first = graded === 0;
  return (
    <Card>
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={SparklesIcon} size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">
            {t(first ? "ads.creatives.analyzeTitle" : "ads.creatives.analyzeAgainTitle")}
          </p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {pending > 0
              ? t(first ? "ads.creatives.analyzeBody" : "ads.creatives.pendingBody", { count: pending })
              : t("ads.creatives.allGraded", { count: graded })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button onClick={onReview} type="button" variant="outline">
            {t("ads.creatives.reviewAction")}
          </Button>
          {pending > 0 ? (
            <Button disabled={analyzing} onClick={onAnalyze} type="button">
              {analyzing ? <Spinner /> : <HugeiconsIcon icon={SparklesIcon} size={15} strokeWidth={1.75} />}
              {analyzing
                ? t("ads.creatives.analyzing", { count: Math.min(pending, 40) })
                : t(first ? "ads.creatives.analyzeAction" : "ads.creatives.analyzePendingAction", { count: pending })}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * "Lo que funciona en tu cuenta": the account-level reading, in sentences.
 * Each line is something the owner can act on — make more of a format, look
 * at an ad, fix one before Meta does — not a statistic to interpret.
 */
function Findings({
  byId,
  report,
}: {
  readonly byId: ReadonlyMap<string, CreativeRow>;
  readonly report: CreativesReport;
}) {
  const t = useT();
  const { summary } = report;
  const best = summary.bestFormat ? summary.formats.find((stat) => stat.format === summary.bestFormat) : undefined;
  const others = summary.formats.filter((stat) => stat.format !== summary.bestFormat);
  const top = summary.topAdId ? byId.get(summary.topAdId) : undefined;
  const risky = summary.riskyAdIds.map((id) => byId.get(id)?.name).filter(Boolean) as string[];

  const othersCost = (() => {
    const spend = others.reduce((sum, stat) => sum + stat.spend, 0);
    const results = others.reduce((sum, stat) => sum + stat.results, 0);
    return results > 0 ? spend / results : null;
  })();
  const othersCtr = (() => {
    const impressions = others.reduce((sum, stat) => sum + stat.impressions, 0);
    const clicks = others.reduce((sum, stat) => sum + (stat.ctr ?? 0) * stat.impressions, 0);
    return impressions > 0 ? clicks / impressions : null;
  })();

  const maxSpend = Math.max(1, ...summary.formats.map((stat) => stat.spend));

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{t("ads.creatives.findingsTitle")}</CardTitle>
          <CardDescription>
            {t("ads.creatives.findingsDescription", {
              count: summary.graded,
              grade: (summary.averageGrade ?? 0).toFixed(1),
            })}
          </CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody>
        <ul className="space-y-3">
          {best && summary.bestFormatBy === "costPerResult" ? (
            <Finding tone="good">
              {t("ads.creatives.findingBestCost", {
                format: t(`ads.creatives.format.${best.format}`),
                cost: formatCurrency(best.costPerResult ?? 0),
                others: othersCost === null ? "—" : formatCurrency(othersCost),
              })}
            </Finding>
          ) : best && summary.bestFormatBy === "ctr" ? (
            <Finding tone="good">
              {t("ads.creatives.findingBestCtr", {
                format: t(`ads.creatives.format.${best.format}`),
                ctr: formatPercent(best.ctr ?? 0),
                others: othersCtr === null ? "—" : formatPercent(othersCtr),
              })}
            </Finding>
          ) : (
            <Finding tone="neutral">{t("ads.creatives.findingNotEnough")}</Finding>
          )}
          {top?.grade ? (
            <Finding tone="good">
              {t("ads.creatives.findingTopAd", {
                name: top.name,
                grade: top.grade.overall.toFixed(1),
                format: t(`ads.creatives.format.${top.grade.format}`),
              })}
            </Finding>
          ) : null}
          {risky.length > 0 ? (
            <Finding tone="risk">
              {t("ads.creatives.findingRisk", { count: risky.length, names: risky.slice(0, 3).join(", ") })}
            </Finding>
          ) : (
            <Finding tone="good">{t("ads.creatives.findingNoRisk")}</Finding>
          )}
        </ul>

        {summary.formats.length > 0 ? (
          <div className="mt-5 space-y-2.5">
            <p className="text-muted-foreground text-xs">{t("ads.creatives.byFormat")}</p>
            {summary.formats.map((stat) => (
              <div className="flex items-center gap-3 text-xs" key={stat.format}>
                <span className="w-32 shrink-0 truncate">{t(`ads.creatives.format.${stat.format}`)}</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      stat.format === summary.bestFormat ? "bg-emerald-500/70" : "bg-foreground/35",
                    )}
                    style={{ width: `${(stat.spend / maxSpend) * 100}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
                  {t("ads.creatives.formatAds", { count: stat.ads })}
                </span>
                <span className="hidden w-28 shrink-0 text-right tabular-nums sm:block">
                  {stat.costPerResult !== null
                    ? t("ads.creatives.perResult", { value: formatCurrency(stat.costPerResult) })
                    : stat.ctr !== null
                      ? t("ads.creatives.ctrValue", { value: formatPercent(stat.ctr) })
                      : "—"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ── Rows ───────────────────────────────────────────────────────────

function Thumbnail({ row }: { readonly row: CreativeRow }) {
  const [failed, setFailed] = useState(false);
  if (row.thumbnailUrl && !failed) {
    return (
      // Meta's signed CDN URL: not something next/image can be configured for
      // ahead of time, and it expires, so it is shown as-is and never stored.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className="size-10 shrink-0 rounded-lg bg-muted object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={row.thumbnailUrl}
      />
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <HugeiconsIcon icon={KIND_ICONS[row.copy.kind]} size={16} strokeWidth={1.75} />
    </div>
  );
}

function CreativeAdRow({
  expanded,
  onToggle,
  row,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly row: CreativeRow;
}) {
  const t = useT();
  const grade = row.grade;
  const ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;

  return (
    <AdsRow
      expanded={expanded}
      label={row.name}
      leading={<Thumbnail row={row} />}
      metrics={
        <div className="hidden items-center gap-2 md:flex">
          <AdsMetric label={t("ads.spend")} value={formatCurrency(row.spend)} />
          <AdsMetric label={t("ads.ctr")} value={formatPercent(ctr)} />
          <AdsMetric
            label={t("ads.creatives.costPerResult")}
            value={row.results > 0 ? formatCurrency(row.spend / row.results) : "—"}
          />
        </div>
      }
      onToggle={onToggle}
      subtitle={
        <>
          <AdsStatusDot status={row.status} />
          <span className="truncate">{formatStatus(row.status, t)}</span>
          {grade ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{t(`ads.creatives.format.${grade.format}`)}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{t(`ads.creatives.funnel.${grade.funnel}`)}</span>
            </>
          ) : null}
          {grade && isRiskyScore(grade.scores.claimRisk) ? (
            <Badge className="ml-1" variant="warning">{t("ads.creatives.riskBadge")}</Badge>
          ) : null}
        </>
      }
      title={row.name}
      trailing={
        grade ? (
          <ScoreRing aria-label={t("ads.creatives.gradeAria", { grade: grade.overall.toFixed(1) })} decimals={1} dimension={40} max={5} size="xs" value={grade.overall} />
        ) : (
          <span className="min-w-10 shrink-0 whitespace-nowrap text-center text-muted-foreground text-xs">
            {row.ungradable ? "—" : t("ads.creatives.notGraded")}
          </span>
        )
      }
    >
      <CreativeDetail row={row} />
    </AdsRow>
  );
}

function CreativeDetail({ row }: { readonly row: CreativeRow }) {
  const t = useT();
  const grade = row.grade;
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        {row.copy.headline ? <p className="font-medium text-sm">{row.copy.headline}</p> : null}
        <p className="line-clamp-6 whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
          {row.copy.primaryText || t("ads.creatives.noText")}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs md:hidden">
          <span>{t("ads.spend")}: {formatCurrency(row.spend)}</span>
          <span>{t("ads.creatives.results")}: {row.results}</span>
        </div>
        {grade ? (
          <p className="text-[11px] text-muted-foreground">
            {t(grade.sawImage ? "ads.creatives.sawImage" : "ads.creatives.textOnly")}
          </p>
        ) : null}
      </div>
      {grade ? <GradeBreakdown grade={grade} /> : (
        <p className="text-muted-foreground text-sm">
          {t(row.ungradable ? "ads.creatives.ungradable" : "ads.creatives.notGradedHint")}
        </p>
      )}
    </div>
  );
}
