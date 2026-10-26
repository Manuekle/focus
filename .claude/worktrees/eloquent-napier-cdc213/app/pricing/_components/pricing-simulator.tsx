"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Building02Icon, Factory01Icon, Store01Icon } from "@hugeicons/core-free-icons";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { CategoryBadge } from "@/components/ui/category-badge";
import { Button } from "@/components/ui/button";
import { LiquidSlider } from "@/components/ui/liquid-slider";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useT } from "@/lib/i18n/provider";
import { recommendPlan, type GaugeKey } from "@/lib/pricing-simulator";
import { Reveal } from "@/app/landing/_components/primitives";

const INDUSTRIES = [
  "retail",
  "services",
  "health",
  "education",
  "realEstate",
  "hospitality",
  "software",
  "other",
] as const;

const GAUGE_ORDER: readonly GaugeKey[] = ["volume", "automation", "coverage", "fit"];

function gaugeColor(score: number): string {
  if (score >= 90) return "#0cce6b";
  if (score >= 50) return "#ffa400";
  return "#ff4e42";
}

const SIZE_STYLE = {
  small: { hue: 155, icon: Store01Icon },
  medium: { hue: 80, icon: Building02Icon },
  large: { hue: 215, icon: Factory01Icon },
} as const;

/** Perfil con el `CategoryBadge` de los canales: tinte por hue, con icono. */
function SizeBadge({ size, label }: { readonly size: keyof typeof SIZE_STYLE; readonly label: string }) {
  return (
    <CategoryBadge hue={SIZE_STYLE[size].hue} className="gap-1.5 px-2.5 py-1">
      <HugeiconsIcon icon={SIZE_STYLE[size].icon} size={13} strokeWidth={2} className="shrink-0" />
      {label}
    </CategoryBadge>
  );
}

function Gauge({ label, value }: { readonly label: string; readonly value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <div className="relative size-[64px] shrink-0" role="img" aria-label={`${label}: ${value} de 100`}>
        <svg viewBox="0 0 76 76" className="size-[64px] -rotate-90">
          <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" className="stroke-border" />
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke={gaugeColor(value)}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (c * value) / 100}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-heading text-base font-medium tabular-nums">
          {value}
        </span>
      </div>
      <p className="max-w-[12ch] text-[13px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

function Step({
  index,
  title,
  hint,
  ruled = true,
  children,
}: {
  readonly index: string;
  readonly title: string;
  readonly hint?: string;
  /** Sin hairline cuando el paso vive en una fila flex/grid — la línea sobra. */
  readonly ruled?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={ruled ? "border-t border-border py-7 first:border-t-0 first:pt-0" : "py-7"}>
      <p className="lp-eyebrow">{index}</p>
      <p className="mt-2 text-[15px] font-medium tracking-tight">{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/**
 * Cuestionario sin tarjeta: pasos sobre hairlines editoriales y resultado en
 * columna propia. Sin `lp-cap`, sin fondos — el aire es el contenedor.
 */
export function PricingSimulator() {
  const t = useT();
  const [industry, setIndustry] = useState<string>("retail");
  const [dailyMessages, setDailyMessages] = useState(80);
  const [monthlyCalls, setMonthlyCalls] = useState(20);
  const [channels, setChannels] = useState<readonly string[]>(["whatsapp"]);
  const [team, setTeam] = useState<"small" | "medium" | "large">("small");
  const [automation, setAutomation] = useState(true);

  const result = useMemo(
    () =>
      recommendPlan({
        dailyMessages,
        monthlyCalls,
        channels: channels.length || 1,
        teamSize: team === "small" ? 3 : team === "large" ? 30 : 12,
        needsAutomation: automation,
      }),
    [dailyMessages, monthlyCalls, channels, team, automation],
  );

  const toggleChannel = (id: string) =>
    setChannels((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const planNameKey =
    result.recommended === "pro"
      ? "pricing.pro.name"
      : result.recommended === "managed"
        ? "pricing.managed.name"
        : "pricing.enterprise.name";

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:gap-16">
      {/* Preguntas */}
      <Reveal>
        <Step index="01" title={t("pricing.sim.qBusiness")}>
          <div className="flex flex-wrap gap-2">
            {INDUSTRIES.map((key) => (
              <ToggleChip key={key} selected={industry === key} onClick={() => setIndustry(key)}>
                {t(`onboarding.industry.${key}`)}
              </ToggleChip>
            ))}
          </div>
        </Step>

        <div className="grid gap-x-8 border-t border-border max-sm:divide-y max-sm:divide-border sm:grid-cols-2">
        <Step index="02" title={t("pricing.sim.qMessages")} hint={t("pricing.sim.qMessagesHint")} ruled={false}>
          <div className="flex items-baseline gap-2">
            <p className="font-heading text-3xl font-medium tabular-nums">{dailyMessages}</p>
            <p className="text-[13px] text-muted-foreground">/día</p>
          </div>
          <LiquidSlider
            value={dailyMessages}
            onValueChange={(v) => setDailyMessages(Math.round(v))}
            min={10}
            max={1000}
            step={10}
            label={t("pricing.sim.qMessages")}
            className="mt-3 max-w-md"
          />
        </Step>

        <Step index="03" title={t("pricing.sim.qCalls")} hint={t("pricing.sim.qCallsHint")} ruled={false}>
          <div className="flex items-baseline gap-2">
            <p className="font-heading text-3xl font-medium tabular-nums">{monthlyCalls}</p>
            <p className="text-[13px] text-muted-foreground">/mes</p>
          </div>
          <LiquidSlider
            value={monthlyCalls}
            onValueChange={(v) => setMonthlyCalls(Math.round(v))}
            min={0}
            max={300}
            step={5}
            label={t("pricing.sim.qCalls")}
            className="mt-3 max-w-md"
          />
        </Step>
        </div>

        <div className="grid gap-x-8 border-t border-border max-sm:divide-y max-sm:divide-border sm:grid-cols-2">
          <Step index="04" title={t("pricing.sim.qTeam")} ruled={false}>
            <div className="flex flex-wrap gap-2">
              {(["small", "medium", "large"] as const).map((s) => (
                <ToggleChip key={s} selected={team === s} onClick={() => setTeam(s)}>
                  {t(`pricing.sim.team.${s}`)}
                </ToggleChip>
              ))}
            </div>
          </Step>

          <Step index="05" title={t("pricing.sim.qChannels")} ruled={false}>
            <div className="flex flex-nowrap gap-2">
              {(["whatsapp", "instagram", "web"] as const).map((c) => (
                <ToggleChip key={c} selected={channels.includes(c)} onClick={() => toggleChannel(c)}>
                  <ChannelIcon channel={c} className="size-4" />
                  {t(`pricing.sim.channel.${c}`)}
                </ToggleChip>
              ))}
            </div>
          </Step>
        </div>

        <Step index="06" title={t("pricing.sim.qAutomation")}>
          <div className="flex flex-wrap gap-2">
            <ToggleChip selected={automation} onClick={() => setAutomation(true)}>
              {t("pricing.sim.auto.yes")}
            </ToggleChip>
            <ToggleChip selected={!automation} onClick={() => setAutomation(false)}>
              {t("pricing.sim.auto.no")}
            </ToggleChip>
          </div>
        </Step>
      </Reveal>

      {/* Resultado */}
      <Reveal delay={100} className="lg:sticky lg:top-24 lg:self-start">
        <p className="lp-eyebrow">{t("pricing.sim.result.eyebrow")}</p>
        <p className="mt-2 font-cooper text-4xl font-medium tracking-tight">{t(planNameKey)}</p>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {t(`pricing.sim.size.${result.businessSize}`)}
        </p>

        <div className="mt-7 grid grid-cols-1 gap-5 min-[420px]:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {GAUGE_ORDER.map((key) => (
            <Gauge key={key} label={t(`pricing.sim.gauge.${key}`)} value={result.gauges[key]} />
          ))}
        </div>

        <dl className="mt-7 border-t border-border">
          {(
            [
              ["monthly", result.monthlyMessages.toLocaleString("es-MX")],
              ["credits", `${(result.estimatedCredits / 1000).toFixed(0)}K`],
              ["hours", `~${result.hoursSaved}h`],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between border-b border-border py-2.5">
              <dt className="text-[13px] text-muted-foreground">{t(`pricing.sim.result.${key}`)}</dt>
              <dd className="font-heading text-lg font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <Button asChild size="lg" className="btn-metal mt-7 w-full">
          <a href={`/pricing#plan-${result.recommended}`}>{t("pricing.sim.result.cta")}</a>
        </Button>
        <div className="mt-3 flex justify-center">
          <SizeBadge size={result.businessSize} label={t(`pricing.sim.size.${result.businessSize}`)} />
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">{t("pricing.sim.result.note")}</p>
      </Reveal>
    </div>
  );
}
