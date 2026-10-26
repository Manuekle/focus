"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight01Icon, SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Card } from "@/app/_components/dashboard-card";
import { useI18n } from "@/lib/i18n/provider";
import { HELP_TUTORIALS, type HelpTutorial } from "@/lib/help-tutorials";
import { normalizeForSearch } from "@/lib/help-faq";
import { StepVideo } from "./step-video";

const CATEGORIES = ["all", "channels", "ai", "sales", "payments", "voice", "email", "other"] as const;
type Category = (typeof CATEGORIES)[number];

function tutorialSearchText(item: HelpTutorial, locale: string) {
  const text = locale === "es" ? item.es : item.en;
  return normalizeForSearch(`${item.name} ${text.summary} ${text.steps.join(" ")} ${text.note ?? ""}`);
}

export function TutorialsPanel({ bookingUrl }: { readonly bookingUrl: string | null }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [selected, setSelected] = useState<string>("whatsapp");
  const matches = useMemo(() => {
    const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
    return HELP_TUTORIALS.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      const haystack = tutorialSearchText(item, locale);
      return words.every((word) => haystack.includes(word));
    });
  }, [category, locale, query]);
  const current = matches.find((item) => item.id === selected) ?? matches[0];
  const copy = locale === "es" ? current?.es : current?.en;
  const isEs = locale === "es";

  return (
    <div className="space-y-5">
      <div className="max-w-3xl">
        <h2 className="text-lg font-medium">{t("help.tutorialsTitle")}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("help.tutorialsIntro", { count: HELP_TUTORIALS.length })}</p>
      </div>
      <div className="relative max-w-xl">
        <HugeiconsIcon icon={SearchIcon} size={16} strokeWidth={1.75} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label={t("help.tutorialSearch")} placeholder={t("help.tutorialSearchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("help.tutorialCategories")}>
        {CATEGORIES.map((id) => <ToggleChip key={id} selected={category === id} onClick={() => setCategory(id)}>{t(`help.tutorialCategory.${id}`)}</ToggleChip>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(15rem,.78fr)_minmax(0,1.5fr)]">
        <nav aria-label={t("help.tutorialList")} className="y-fade max-h-[38rem] space-y-2 overflow-y-auto pr-1">
          {matches.length ? matches.map((item) => {
            const localized = isEs ? item.es : item.en;
            const active = item.id === current?.id;
            return <button key={item.id} type="button" aria-pressed={active} onClick={() => setSelected(item.id)} className={`w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] ${active ? "border-foreground/30 bg-card shadow-[var(--shadow-soft)]" : "border-border bg-card/60 hover:bg-card"}`}>
              <span className="flex items-center justify-between gap-3 text-sm font-medium"><span>{item.name}</span><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`help.tutorialCategory.${item.category}`)}</span></span>
              <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{localized.summary}</span>
            </button>;
          }) : <Card className="p-5 text-sm text-muted-foreground">{t("help.tutorialNoResults")}</Card>}
        </nav>
        {current && copy ? <article className="min-w-0 space-y-4" aria-live="polite">
          <Card className="space-y-4 p-5 sm:p-6">
            <header>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t(`help.tutorialCategory.${current.category}`)}</p>
              <h3 className="mt-1 text-xl font-medium">{current.name}</h3>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{copy.summary}</p>
            </header>
            <ol className="space-y-3">
              {copy.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-relaxed"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">{index + 1}</span><span>{step}</span></li>)}
            </ol>
            {copy.note ? <p className="rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">{copy.note}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><Link href={current.href}>{t("help.tutorialOpenSetup")}<HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} /></Link></Button>
              {current.docs ? <Button asChild variant="outline" size="sm"><a href={current.docs} target="_blank" rel="noopener noreferrer">{t("help.tutorialOfficialDocs")}</a></Button> : null}
            </div>
          </Card>
          <StepVideo key={current.id} title={current.name} steps={copy.steps} labels={{ create: t("help.tutorialCreateVideo"), creating: t("help.tutorialCreatingVideo"), unsupported: t("help.tutorialVideoUnsupported"), alt: t("help.tutorialVideoDescription", { name: current.name }), brandNote: t("help.tutorialVideoFooter") }} />
          {bookingUrl ? <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div><h3 className="text-sm font-medium">{t("help.bookingTitle")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("help.bookingHint")}</p></div>
            <Button asChild variant="outline" size="sm"><a href={bookingUrl} target="_blank" rel="noopener noreferrer">{t("help.bookingAction")}<HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} /></a></Button>
          </Card> : null}
        </article> : null}
      </div>
    </div>
  );
}
