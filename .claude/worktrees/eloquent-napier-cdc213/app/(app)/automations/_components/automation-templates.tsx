"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowRight01Icon, FileImportIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CategoryBadge } from "@/components/ui/category-badge";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Card } from "../../../_components/dashboard-card";
import { CardCarousel } from "../../../_components/card-carousel";
import {
  AUTOMATION_TEMPLATES,
  automationTemplateBody,
  flattenSteps,
  type AutomationTemplate,
  type AutomationTemplateLevel,
} from "@/lib/automation-templates";
import { STEP_HUES, STEP_ICONS, STEP_LABEL_KEYS } from "@/lib/workflow-step-meta";
import { useI18n, useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { TRIGGER_ICONS, TRIGGER_LABELS } from "./automation-meta";

/** One hue per level, so the board reads basic → advanced at a glance. */
const LEVEL_HUES: Record<AutomationTemplateLevel, number> = {
  basic: 165,
  intermediate: 65,
  advanced: 295,
};

type LevelFilter = "all" | AutomationTemplateLevel;

/** How many step chips a card shows before it says "+N". */
const CHAIN_LIMIT = 6;

/**
 * The template board: ready-made automations from a one-step reply to a
 * branching sequence, plus a card for bringing a flow over from n8n.
 *
 * Same rail as the agent and skill boards. Using a template is a plain POST of
 * a filled-in flow — the automation it creates is a draft like any other,
 * editable on its canvas and never live until someone switches it on.
 */
export function AutomationTemplates({
  usingId,
  onUse,
  onImport,
}: {
  /** The template being created right now, if any — its button spins. */
  readonly usingId: string | null;
  readonly onUse: (template: AutomationTemplate) => void;
  readonly onImport: () => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [level, setLevel] = useState<LevelFilter>("all");

  const shown = useMemo(
    () => AUTOMATION_TEMPLATES.filter((template) => level === "all" || template.level === level),
    [level],
  );

  return (
    <section className="mt-10" aria-labelledby="automation-templates-title">
      <header className="mb-4 flex flex-col gap-3 @min-[640px]:flex-row @min-[640px]:items-end @min-[640px]:justify-between">
        <div className="max-w-xl">
          <h2 id="automation-templates-title" className="text-lg font-medium">
            {t("automations.templatesTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("automations.templatesSubtitle")}</p>
        </div>
        <SlidingTabs
          className="self-start @min-[640px]:self-auto"
          tabs={[
            { id: "all", label: t("automations.templatesAll") },
            { id: "basic", label: t("automations.templatesBasic") },
            { id: "intermediate", label: t("automations.templatesIntermediate") },
            { id: "advanced", label: t("automations.templatesAdvanced") },
          ]}
          value={level}
          onValueChange={(id) => setLevel(id as LevelFilter)}
        />
      </header>

      <CardCarousel label={t("automations.templatesTitle")}>
        <div className="flex items-stretch gap-3 pb-1" style={{ paddingInline: "2px" }}>
          {shown.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              locale={locale}
              busy={usingId === template.id}
              disabled={usingId !== null}
              onUse={() => onUse(template)}
            />
          ))}

          {/* Bringing a flow in from n8n sits on the same board: it is the
              other way to start from something instead of from nothing. */}
          <Card className="flex w-[min(300px,80vw)] shrink-0 flex-col border-dashed bg-muted/20">
            <div className="flex flex-1 flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={FileImportIcon} size={20} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t("automations.templatesImportTitle")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("automations.templatesImportDesc")}</p>
                </div>
              </div>
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="w-full" onClick={onImport}>
                {t("automations.templatesImportAction")}
              </Button>
            </div>
          </Card>
        </div>
      </CardCarousel>
    </section>
  );
}

function TemplateCard({
  template,
  locale,
  busy,
  disabled,
  onUse,
}: {
  readonly template: AutomationTemplate;
  readonly locale: "es" | "en";
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onUse: () => void;
}) {
  const t = useT();
  const body = automationTemplateBody(template, locale);
  const total = flattenSteps(body.steps).length;
  const chain = body.steps.slice(0, CHAIN_LIMIT);
  const hidden = body.steps.length - chain.length;

  const requires = template.requires.map((req) => t(`automations.templateRequirement.${req}`)).join(" · ");

  // Every row below has a fixed height — one line for the name, two for the
  // summary, one each for the trigger, the chain and the requirements. The
  // rail stretches every card to the tallest one, so a row that grew with its
  // text left the short cards with a hole in the middle.
  return (
    <Card interactive className="flex w-[min(300px,80vw)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[var(--shadow-inset)]",
              template.accent,
            )}
          >
            <HugeiconsIcon icon={template.icon} size={20} strokeWidth={1.75} />
          </div>
          <CategoryBadge hue={LEVEL_HUES[template.level]} size="sm">
            {t(`automations.templateLevel.${template.level}`)}
          </CategoryBadge>
        </div>

        <div className="space-y-1">
          <p className="truncate text-sm font-medium" title={body.name}>
            {body.name}
          </p>
          <p className="line-clamp-2 h-10 text-xs leading-5 text-muted-foreground" title={body.summary}>
            {body.summary}
          </p>
        </div>

        {/* When it fires, then what it does — the two things a flow is. */}
        <div className="space-y-2 rounded-xl bg-muted/50 p-2.5 shadow-[var(--shadow-inset)]">
          <p className="flex h-4 min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={TRIGGER_ICONS[template.trigger]} size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="shrink-0 font-medium text-foreground/80">{t(TRIGGER_LABELS[template.trigger])}</span>
            {body.triggerValue ? (
              <code className="min-w-0 truncate rounded bg-card px-1 py-px font-mono text-[10px]" title={body.triggerValue}>
                {body.triggerValue}
              </code>
            ) : null}
          </p>

          <div className="flex h-5 items-center gap-1.5">
            <ol className="flex min-w-0 items-center gap-0.5 overflow-hidden" aria-label={t("automations.workflow")}>
              {chain.map((step, index) => (
                // Relative so the chip's sr-only label is positioned inside the
                // card: absolute, it escaped the carousel's scroller and gave
                // the whole page a horizontal scrollbar.
                <li key={index} className="relative flex shrink-0 items-center gap-0.5">
                  {index > 0 ? (
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      size={10}
                      strokeWidth={2}
                      className="text-muted-foreground/60"
                      aria-hidden="true"
                    />
                  ) : null}
                  <CategoryBadge hue={STEP_HUES[step.type]} size="sm" className="w-5 justify-center px-0" title={t(STEP_LABEL_KEYS[step.type])}>
                    <HugeiconsIcon icon={STEP_ICONS[step.type]} size={12} strokeWidth={1.75} aria-hidden="true" />
                    <span className="sr-only">{t(STEP_LABEL_KEYS[step.type])}</span>
                  </CategoryBadge>
                </li>
              ))}
              {hidden > 0 ? <li className="shrink-0 text-[10px] text-muted-foreground">+{hidden}</li> : null}
            </ol>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {t("automations.stepCount", { count: total })}
            </span>
          </div>
        </div>

        {/* Always one line, even with nothing to connect: a missing row is
            what made the basic cards shorter than the rest. */}
        <p className="truncate text-[11px] text-muted-foreground" title={requires || undefined}>
          <span className="font-medium text-foreground/80">{t("automations.templateRequires")}:</span>{" "}
          {requires || t("automations.templateRequiresNone")}
        </p>

        <Button size="sm" className="w-full" disabled={disabled} onClick={onUse}>
          {busy ? (
            <>
              <Spinner size={14} />
              {t("automations.templateUsing")}
            </>
          ) : (
            t("automations.templateUse")
          )}
        </Button>
      </div>
    </Card>
  );
}
