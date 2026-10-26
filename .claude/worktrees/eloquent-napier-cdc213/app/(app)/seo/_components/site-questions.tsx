"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { BubbleChatQuestionIcon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "../../../_components/dashboard-card";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { ProductFigure, type ProductFigureKind } from "@/components/hairline/product-figure";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useI18n, useT } from "@/lib/i18n/provider";
import type { QuestionsReading } from "@/lib/site-questions-policy";

// The Preguntas tab: what customers ask on WhatsApp and Instagram that the
// site does not answer (lib/site-questions.ts).
//
// Like the audit tab, it needs no Google account — only the inbox and a
// public site. A visit reads what is stored and spends nothing; "Revisar
// preguntas" reads the site when it is not on file and asks Jev about the
// questions it has not seen.

export type SiteQuestionsReply = {
  readonly ready: boolean;
  readonly site: string | null;
  readonly pages: { readonly count: number; readonly fetchedAt: string; readonly paths: readonly string[] } | null;
  readonly siteError?: "unreachable" | "empty";
  readonly pending: number;
  readonly matchedNow: number;
  readonly reading: QuestionsReading;
};

/** Pages listed under "Ya lo responde tu sitio". The rest answer little. */
const ANSWERING_SHOWN = 8;

function siteLabel(site: string): string {
  return site.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function SiteQuestionsPanel() {
  const t = useT();
  const [reply, setReply] = useState<SiteQuestionsReply | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const load = useCallback(async () => {
    const result = await fetchJson<SiteQuestionsReply>("/api/seo/questions", t);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReply(result.data);
  }, [t]);

  useEffect(() => {
    void fetchJson<SiteQuestionsReply>("/api/seo/questions", t).then((result) => {
      if (result.ok) setReply(result.data);
      else setError(result.error);
    });
  }, [t]);

  const analyze = async () => {
    setAnalyzing(true);
    const result = await fetchJson<SiteQuestionsReply>("/api/seo/questions", t, { method: "POST" });
    setAnalyzing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReply(result.data);
  };

  if (!reply) {
    return error ? <ErrorBanner error={error} onRetry={() => void load()} /> : <QuestionsSkeleton />;
  }

  const { reading } = reply;
  if (reading.found === 0) {
    return <StateCard body={t("seo.questions.emptyBody")} figure="empty-archive" title={t("seo.questions.emptyTitle")} />;
  }
  if (!reply.ready) {
    return (
      <StateCard
        action={{ href: "/settings", label: t("seo.questions.needsKeyAction") }}
        body={t("seo.questions.needsKeyBody", { count: reading.found })}
        figure="rack"
        title={t("seo.questions.needsKeyTitle")}
      />
    );
  }
  if (!reply.site) {
    return (
      <StateCard
        action={{ href: "/knowledge", label: t("seo.questions.noSiteAction") }}
        body={t("seo.questions.noSiteBody", { count: reading.found })}
        figure="archive"
        title={t("seo.questions.noSiteTitle")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <AnalyzeCard analyzing={analyzing} onAnalyze={() => void analyze()} reply={reply} site={reply.site} />
      {reading.judged > 0 ? <Gaps reading={reading} /> : null}
      {reading.answering.length > 0 ? <Answering reading={reading} /> : null}
    </div>
  );
}

function AnalyzeCard({
  analyzing,
  onAnalyze,
  reply,
  site,
}: {
  readonly analyzing: boolean;
  readonly onAnalyze: () => void;
  readonly reply: SiteQuestionsReply;
  readonly site: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const label = siteLabel(site);
  const pages = reply.reading.judged > 0 ? reply.pages : null;
  const body = pages === null
    ? t("seo.questions.firstBody", { count: reply.reading.found, site: label })
    : reply.pending > 0
      ? t("seo.questions.pendingBody", { count: reply.pending })
      : t("seo.questions.doneBody", {
          count: reply.reading.found,
          pages: pages.count,
          site: label,
          date: new Date(pages.fetchedAt).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
            day: "numeric",
            month: "long",
          }),
        });

  return (
    <Card>
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={BubbleChatQuestionIcon} size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{t("seo.questions.title")}</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">{body}</p>
          {reply.siteError ? (
            <p className="mt-2 text-amber-700 text-xs leading-relaxed dark:text-amber-400" role="alert">
              {t(reply.siteError === "empty" ? "seo.questions.siteEmpty" : "seo.questions.siteUnreachable", { site: label })}
            </p>
          ) : null}
        </div>
        {pages === null || reply.pending > 0 ? (
          <Button className="shrink-0" disabled={analyzing} onClick={onAnalyze} type="button">
            {analyzing ? <Spinner /> : <HugeiconsIcon icon={BubbleChatQuestionIcon} size={15} strokeWidth={1.75} />}
            {t(analyzing ? "seo.questions.analyzing" : "seo.questions.analyze")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** "Lo que tu sitio no responde": one row per topic, most asked first, with
 *  the customers' own words and what to write. */
function Gaps({ reading }: { readonly reading: QuestionsReading }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{t("seo.questions.gapsTitle")}</CardTitle>
          <CardDescription>
            {reading.unanswered > 0
              ? t("seo.questions.gapsDescription", { count: reading.unanswered, total: reading.general, asks: reading.unansweredAsks })
              : t("seo.questions.intro")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody>
        {reading.gaps.length === 0 ? (
          <p className="flex items-start gap-2.5 text-sm leading-relaxed">
            <HugeiconsIcon
              className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              icon={CheckmarkCircle02Icon}
              size={16}
              strokeWidth={1.75}
            />
            {t("seo.questions.noGaps")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {reading.gaps.map((gap) => (
              <li className="py-4 first:pt-0 last:pb-0" key={gap.topic}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium text-sm">{t(`seo.questions.topic.${gap.topic}`)}</p>
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {t("seo.questions.customers", { count: gap.asks })}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {gap.examples.map((example) => (
                    <li className="text-muted-foreground text-sm leading-relaxed" key={example.text}>
                      «{example.text}»
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-relaxed">
                  <span className="font-medium">{t("seo.questions.write")}</span> {t(`seo.questions.tip.${gap.topic}`)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** The pages that already answer something, so the owner sees what works and
 *  what to keep near the top of those pages. */
function Answering({ reading }: { readonly reading: QuestionsReading }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{t("seo.questions.answeringTitle")}</CardTitle>
          <CardDescription>{t("seo.questions.answeringDescription", { count: reading.answered })}</CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody>
        <ul className="divide-y divide-border">
          {reading.answering.slice(0, ANSWERING_SHOWN).map((page) => (
            <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" key={page.path}>
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{page.path === "/" ? t("seo.questions.homePage") : page.path}</p>
                {page.examples[0] ? (
                  <p className="mt-0.5 truncate text-muted-foreground text-xs">«{page.examples[0].text}»</p>
                ) : null}
              </div>
              <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                {t("seo.questions.customers", { count: page.asks })}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** A state only a step elsewhere fixes — no key, no site — or nothing to read
 *  yet. Each names where the fix lives. */
function StateCard({
  action,
  body,
  figure,
  title,
}: {
  readonly action?: { readonly href: string; readonly label: string };
  readonly body: string;
  readonly figure: ProductFigureKind;
  readonly title: string;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 px-5 py-10 text-center sm:flex-row sm:text-left">
        <ProductFigure className="h-24 w-32 shrink-0" kind={figure} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{title}</p>
          <p className="mt-1 max-w-lg text-muted-foreground text-xs leading-relaxed">{body}</p>
        </div>
        {action ? (
          <Button asChild variant="outline">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function QuestionsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <Card>
        <div className="flex items-center gap-4 px-5 py-5">
          <SkeletonBar className="size-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <SkeletonBar className="h-3.5 w-48" />
            <SkeletonBar className="h-3 w-80 max-w-full" />
          </div>
        </div>
      </Card>
      <Card>
        <div className="space-y-4 px-5 py-5">
          <SkeletonBar className="h-3.5 w-56" />
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-5/6" />
          <SkeletonBar className="h-3 w-2/3" />
        </div>
      </Card>
    </div>
  );
}
