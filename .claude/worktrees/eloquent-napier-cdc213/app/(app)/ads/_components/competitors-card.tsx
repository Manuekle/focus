"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Cancel01Icon, Image01Icon, Search01Icon, TextIcon, Video01Icon } from "@hugeicons/core-free-icons";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "../../../_components/dashboard-card";
import { AdsRow } from "../../../_components/ads-rows";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { ScoreRing } from "@/components/ui/score-ring";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { benchmark, type RivalAd } from "@/lib/ad-benchmark-policy";
import type { AdGrade } from "@/lib/ad-grader-policy";
import { fetchJson, isApiError, type UiError } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import { Finding, GradeBreakdown } from "./creative-grade";

/**
 * "Tu competencia": a competitor's ads from Meta's Ad Library, graded with the
 * rubric the owner's own ads get, and the comparison read out in sentences —
 * where they are ahead, what format they lean on, which of their ads have run
 * longest (the closest public sign that an ad works).
 *
 * One field, one button: paste a Facebook page or an Ad Library link. Without
 * an Apify token the same card takes an ad pasted by hand.
 */

type CompetitorAd = {
  readonly id: string;
  readonly competitor: string;
  readonly source: "ad_library" | "manual";
  readonly copy: { readonly primaryText: string; readonly headline: string; readonly kind: "video" | "image" | "carousel" | "text" };
  readonly imageUrl?: string;
  readonly daysActive?: number;
  readonly isActive?: boolean;
  readonly grade: AdGrade | null;
};

type CompetitorsReply = {
  readonly importReady: boolean;
  readonly graderReady: boolean;
  readonly ads: readonly CompetitorAd[];
};

const KIND_ICONS = { video: Video01Icon, image: Image01Icon, carousel: Image01Icon, text: TextIcon } as const;
const SHOWN = 8;

function labelOf(ad: CompetitorAd): string {
  const text = ad.copy.headline || ad.copy.primaryText;
  return text ? (text.length > 70 ? `${text.slice(0, 67)}…` : text) : ad.competitor;
}

/** The reason an import failed, as the route reports it in `detail`. */
function failureKey(error: UiError): string {
  const detail = isApiError(error) ? error.detail : undefined;
  return `ads.competitors.error.${detail && /^[a-z_]+$/.test(detail) ? detail : "upstream"}`;
}

export function CompetitorsCard({
  graderReady,
  ownGrades,
}: {
  readonly graderReady: boolean;
  readonly ownGrades: readonly AdGrade[];
}) {
  const t = useT();
  const [reply, setReply] = useState<CompetitorsReply | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void fetchJson<CompetitorsReply>("/api/ads/competitors", t).then((result) => {
      if (result.ok) setReply(result.data);
    });
  }, [t]);

  const ads = useMemo(() => reply?.ads ?? [], [reply]);
  const rivals: RivalAd[] = useMemo(
    () => ads.map((ad) => ({ id: ad.id, competitor: ad.competitor, label: labelOf(ad), grade: ad.grade, daysActive: ad.daysActive, isActive: ad.isActive })),
    [ads],
  );
  const reading = useMemo(() => benchmark(ownGrades, rivals), [ownGrades, rivals]);
  const competitors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ad of ads) counts.set(ad.competitor, (counts.get(ad.competitor) ?? 0) + 1);
    return [...counts];
  }, [ads]);

  const bring = async () => {
    setBusy(true);
    setFailure(null);
    const result = await fetchJson<CompetitorsReply>("/api/ads/competitors", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(failureKey(result.error));
      return;
    }
    setUrl("");
    setReply(result.data);
  };

  const forget = async (competitor: string) => {
    const result = await fetchJson<CompetitorsReply>(
      `/api/ads/competitors?${new URLSearchParams({ competitor })}`,
      t,
      { method: "DELETE" },
    );
    if (result.ok) setReply(result.data);
  };

  if (!reply) return null;
  const canImport = reply.importReady && graderReady;
  const percent = (share: number) => `${Math.round(share * 100)}%`;

  return (
    <Card>
      <ManualAdDrawer
        onAdded={(next) => setReply(next)}
        onOpenChange={setManualOpen}
        open={manualOpen}
        ready={graderReady}
      />
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{t("ads.competitors.title")}</CardTitle>
          <CardDescription>{t("ads.competitors.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (canImport && url.trim() && !busy) void bring();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <HugeiconsIcon
              className="-translate-y-1/2 absolute top-1/2 left-3 text-muted-foreground"
              icon={Search01Icon}
              size={16}
              strokeWidth={1.75}
            />
            <Input
              aria-label={t("ads.competitors.urlLabel")}
              className="pl-9"
              disabled={!canImport || busy}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("ads.competitors.urlPlaceholder")}
              value={url}
            />
          </div>
          <Button disabled={!canImport || busy || !url.trim()} type="submit">
            {busy ? <Spinner /> : null}
            {t(busy ? "ads.competitors.importing" : "ads.competitors.import")}
          </Button>
          <Button disabled={!graderReady} onClick={() => setManualOpen(true)} type="button" variant="outline">
            {t("ads.competitors.addManual")}
          </Button>
        </form>

        {busy ? <p className="mt-2 text-muted-foreground text-xs">{t("ads.competitors.importingHint")}</p> : null}
        {failure ? <p className="mt-2 text-amber-700 text-xs dark:text-amber-400" role="alert">{t(failure)}</p> : null}
        {!reply.importReady ? (
          <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
            {t("ads.competitors.needsApify")}{" "}
            <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/connections">
              {t("ads.competitors.needsApifyAction")}
            </Link>
          </p>
        ) : null}

        {competitors.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {competitors.map(([name, count]) => (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs" key={name}>
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">· {t("ads.creatives.formatAds", { count })}</span>
                <button
                  aria-label={t("ads.competitors.remove", { name })}
                  className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => void forget(name)}
                  type="button"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {reading.theirGraded > 0 ? (
          <>
            <ul className="mt-5 space-y-3">
              {reading.averageOwn !== null && reading.averageTheirs !== null ? (
                <Finding tone="neutral">
                  {t("ads.competitors.average", {
                    own: reading.averageOwn.toFixed(1),
                    theirs: reading.averageTheirs.toFixed(1),
                  })}
                </Finding>
              ) : null}
              {reading.gaps.map((gap) => (
                <Finding key={gap.dimension} tone="risk">
                  {t("ads.competitors.gap", {
                    dimension: t(`ads.creatives.dim.${gap.dimension}`),
                    theirs: gap.theirs.toFixed(1),
                    own: gap.own.toFixed(1),
                  })}{" "}
                  {t(`ads.creatives.tip.${gap.dimension}`)}
                </Finding>
              ))}
              {reading.theirFormat ? (
                <Finding tone="risk">
                  {t("ads.competitors.format", {
                    format: t(`ads.creatives.format.${reading.theirFormat.format}`),
                    theirs: percent(reading.theirFormat.theirs),
                    own: percent(reading.theirFormat.own),
                  })}
                </Finding>
              ) : null}
              {reading.longestRunning[0] ? (
                <Finding tone="good">
                  {t("ads.competitors.longest", {
                    ad: reading.longestRunning[0].label,
                    competitor: reading.longestRunning[0].competitor,
                    days: reading.longestRunning[0].daysActive ?? 0,
                  })}
                </Finding>
              ) : null}
              {reading.boldest?.grade ? (
                <Finding tone="good">
                  {t("ads.competitors.boldest", {
                    ad: reading.boldest.label,
                    competitor: reading.boldest.competitor,
                    score: reading.boldest.grade.scores.boldness.toFixed(1),
                  })}
                </Finding>
              ) : null}
            </ul>

            {reading.ownGraded > 0 ? (
              <div className="mt-5 space-y-2.5">
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/50" />{t("ads.competitors.you")}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-500/70" />{t("ads.competitors.them")}</span>
                </div>
                {reading.dimensions.map((row) => (
                  <div className="flex items-center gap-3 text-xs" key={row.dimension}>
                    <span className="w-28 shrink-0 truncate text-muted-foreground">{t(`ads.creatives.dim.${row.dimension}`)}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground/50" style={{ width: `${((row.own ?? 0) / 4) * 100}%` }} />
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${((row.theirs ?? 0) / 4) * 100}%` }} />
                      </div>
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums">
                      {(row.own ?? 0).toFixed(1)} · {(row.theirs ?? 0).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 space-y-2">
              {(showAll ? ads : ads.slice(0, SHOWN)).map((ad) => (
                <AdsRow
                  expanded={expandedId === ad.id}
                  key={ad.id}
                  label={labelOf(ad)}
                  leading={<RivalThumbnail ad={ad} />}
                  onToggle={() => setExpandedId(expandedId === ad.id ? null : ad.id)}
                  subtitle={
                    <>
                      <span className="truncate">{ad.competitor}</span>
                      {ad.grade ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{t(`ads.creatives.format.${ad.grade.format}`)}</span>
                        </>
                      ) : null}
                      {ad.daysActive !== undefined ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{t("ads.competitors.days", { days: ad.daysActive })}</span>
                        </>
                      ) : null}
                    </>
                  }
                  title={labelOf(ad)}
                  trailing={
                    ad.grade ? (
                      <ScoreRing
                        aria-label={t("ads.creatives.gradeAria", { grade: ad.grade.overall.toFixed(1) })}
                        decimals={1}
                        dimension={40}
                        max={5}
                        size="xs"
                        value={ad.grade.overall}
                      />
                    ) : (
                      <span className="min-w-10 shrink-0 whitespace-nowrap text-center text-muted-foreground text-xs">
                        {t("ads.creatives.notGraded")}
                      </span>
                    )
                  }
                >
                  <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <p className="line-clamp-6 whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
                      {ad.copy.primaryText || t("ads.creatives.noText")}
                    </p>
                    {ad.grade ? <GradeBreakdown grade={ad.grade} /> : null}
                  </div>
                </AdsRow>
              ))}
              {ads.length > SHOWN ? (
                <Button className="w-full" onClick={() => setShowAll(!showAll)} type="button" variant="ghost">
                  {showAll ? t("ads.competitors.showLess") : t("ads.competitors.showAll", { count: ads.length })}
                </Button>
              ) : null}
            </div>
          </>
        ) : competitors.length === 0 ? (
          <p className="mt-4 text-muted-foreground text-xs leading-relaxed">{t("ads.competitors.empty")}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function RivalThumbnail({ ad }: { readonly ad: CompetitorAd }) {
  const [failed, setFailed] = useState(false);
  if (ad.imageUrl && !failed) {
    return (
      // Meta's signed CDN URL, shown as-is; it may expire, then the icon shows.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className="size-10 shrink-0 rounded-lg bg-muted object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={ad.imageUrl}
      />
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <HugeiconsIcon icon={KIND_ICONS[ad.copy.kind]} size={16} strokeWidth={1.75} />
    </div>
  );
}

/** A competitor's ad pasted by hand — the way in with no Apify account. */
function ManualAdDrawer({
  onAdded,
  onOpenChange,
  open,
  ready,
}: {
  readonly onAdded: (reply: CompetitorsReply) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly ready: boolean;
}) {
  const t = useT();
  const [competitor, setCompetitor] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const add = async () => {
    setBusy(true);
    setFailed(false);
    const result = await fetchJson<CompetitorsReply>("/api/ads/competitors", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ competitor, primaryText, headline }),
    });
    setBusy(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    onAdded(result.data);
    setPrimaryText("");
    setHeadline("");
    onOpenChange(false);
  };

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>{t("ads.competitors.manualTitle")}</DrawerTitle>
          <DrawerDescription>{t("ads.competitors.manualDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="rival-name">{t("ads.competitors.nameLabel")}</label>
              <Input id="rival-name" maxLength={120} onChange={(e) => setCompetitor(e.target.value)} placeholder={t("ads.competitors.namePlaceholder")} value={competitor} />
            </div>
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="rival-text">{t("ads.review.textLabel")}</label>
              <Textarea id="rival-text" maxLength={3000} onChange={(e) => setPrimaryText(e.target.value)} rows={6} value={primaryText} />
            </div>
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="rival-headline">{t("ads.review.headlineLabel")}</label>
              <Input id="rival-headline" maxLength={300} onChange={(e) => setHeadline(e.target.value)} value={headline} />
            </div>
            {failed ? <p className="text-amber-700 text-xs dark:text-amber-400" role="alert">{t("ads.competitors.error.upstream")}</p> : null}
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">{t("ads.review.close")}</Button>
          <Button disabled={!ready || busy || !competitor.trim() || !primaryText.trim()} onClick={() => void add()} type="button">
            {busy ? <Spinner /> : null}
            {t("ads.competitors.manualAction")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
