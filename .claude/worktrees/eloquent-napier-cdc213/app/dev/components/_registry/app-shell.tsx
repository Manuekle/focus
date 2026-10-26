"use client";

// app/_components — las piezas que solo existen dentro de la app firmada: la
// tarjeta del panel, los tiles de métrica, las gráficas y las pastillas que
// dependen de tipos del dominio.

import { ct } from "../_lib/catalog-i18n";
import { BubbleChatIcon, CallIcon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardSeparator,
  CardTitle,
} from "@/app/_components/dashboard-card";
import { RankedBars, TimeSeries } from "@/app/_components/chart";
import { ChannelBadge, ChannelIcon } from "@/app/_components/channel-badge";
import { KpiBars, KpiCard, KpiSparkline, KpiSplit } from "@/app/_components/kpi-card";
import { ProspectBadge } from "@/app/_components/prospect-badge";
import type { ContactChannel } from "@/lib/types";
import type { Section } from "../_lib/types";

const CHANNELS: readonly ContactChannel[] = ["whatsapp", "instagram", "web", "form", "voice"];

const SERIES = [
  { key: "l", label: "Lun", value: 128 },
  { key: "m", label: "Mar", value: 164 },
  { key: "x", label: "Mié", value: 96 },
  { key: "j", label: "Jue", value: 212 },
  { key: "v", label: "Vie", value: 188 },
  { key: "s", label: "Sáb", value: 74 },
  { key: "d", label: "Dom", value: 41 },
] as const;

export function appShell(_locale?: string): Section {
  return {
  id: "app",
  title: ct("app.title"),
  desc: ct("app.desc"),
  entries: [
    {
      id: "dashboard-card",
      name: "Card",
      source: "app/_components/dashboard-card.tsx",
      importLine: 'import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";',
      desc: ct("app.card.desc"),
      exports: ["Card", "CardHeader", "CardBody", "CardTitle", "CardDescription", "CardSeparator"],
      props: [
        { name: "interactive", type: "boolean", desc: ct("app.card.interactive.desc") },
        { name: "onClick", type: "() => void", desc: "" },
        { name: "style", type: "CSSProperties", desc: ct("app.card.style.desc") },
      ],
      demos: [
        {
          id: "dashboard-card-basic",
          title: ct("app.card.title"),
          surface: "page",
          code: `<Card interactive>
  <CardHeader>
    <CardTitle>Conversaciones</CardTitle>
    <CardDescription>Últimos 7 días</CardDescription>
  </CardHeader>
  <CardSeparator />
  <CardBody>…</CardBody>
</Card>`,
          render: (
            <div className="grid w-full gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Conversaciones</CardTitle>
                  <CardDescription>Últimos 7 días</CardDescription>
                </CardHeader>
                <CardSeparator />
                <CardBody>
                  <p className="text-sm text-muted-foreground">903 mensajes en 5 canales.</p>
                </CardBody>
              </Card>
              <Card interactive>
                <CardHeader>
                  <CardTitle>Automatizaciones</CardTitle>
                  <CardDescription>interactive</CardDescription>
                </CardHeader>
                <CardSeparator />
                <CardBody>
                  <p className="text-sm text-muted-foreground">Pasa el ratón por encima.</p>
                </CardBody>
              </Card>
            </div>
          ),
        },
      ],
    },
    {
      id: "kpi-card",
      name: "KpiCard",
      source: "app/_components/kpi-card.tsx",
      importLine: 'import { KpiCard, KpiBars, KpiSparkline, KpiSplit } from "@/app/_components/kpi-card";',
      desc: ct("app.kpiCard.desc"),
      exports: ["KpiCard", "KpiBars", "KpiSparkline", "KpiSplit"],
      props: [
        { name: "value", type: "number | string", required: true, desc: ct("app.kpiCard.value.desc") },
        { name: "label", type: "string", required: true, desc: "" },
        { name: "icon", type: "IconSvgElement", required: true, desc: "De @hugeicons/core-free-icons." },
        { name: "delta", type: "KpiDelta", desc: ct("app.kpiCard.delta.desc") },
        { name: "sub", type: "string", desc: ct("app.kpiCard.sub.desc") },
        { name: "visual", type: "ReactNode", desc: ct("app.kpiCard.visual.desc") },
        { name: "ratio (Bars)", type: "number", desc: ct("app.kpiCard.ratio.desc") },
        { name: "points (Sparkline)", type: "readonly number[]", desc: ct("app.kpiCard.points.desc") },
        { name: "parts (Split)", type: "{ tone, value }[]", desc: ct("app.kpiCard.parts.desc") },
      ],
      notes: [
        ct("app.kpiCard.note"),
      ],
      demos: [
        {
          id: "kpi-card-basic",
          title: ct("app.kpiCard.title"),
          surface: "page",
          code: `<KpiCard
  icon={BubbleChatIcon}
  label="Conversaciones"
  value="1.284"
  delta={{ direction: "up", value: "+8,4 %", label: "vs. semana pasada" }}
  visual={<KpiSparkline points={[4, 9, 6, 12, 10, 16]} tone="positive" />}
/>`,
          render: (
            <div className="grid w-full gap-4 sm:grid-cols-3">
              <KpiCard
                icon={BubbleChatIcon}
                label="Conversaciones"
                value="1.284"
                delta={{ direction: "up", value: "+8,4 %", label: "vs. semana pasada" }}
                visual={<KpiSparkline points={[4, 9, 6, 12, 10, 16]} tone="positive" />}
              />
              <KpiCard
                icon={CallIcon}
                label="Latencia media"
                value="1,9 s"
                delta={{ direction: "down", value: "−0,4 s", tone: "positive" }}
                visual={<KpiBars ratio={0.36} tone="positive" />}
              />
              <KpiCard
                icon={UserMultipleIcon}
                label="Prospectos"
                value="312"
                sub="Repartidos por etapa"
                visual={
                  <KpiSplit
                    parts={[
                      { tone: "positive", value: 140 },
                      { tone: "warning", value: 96 },
                      { tone: "critical", value: 76 },
                    ]}
                  />
                }
              />
            </div>
          ),
        },
      ],
    },
    {
      id: "chart",
      name: "Gráficas",
      source: "app/_components/chart.tsx",
      importLine: 'import { RankedBars, TimeSeries } from "@/app/_components/chart";',
      desc: ct("app.chart.desc"),
      exports: ["RankedBars", "TimeSeries", "ChartTone", "RankedBar", "TimePoint"],
      props: [
        { name: "bars", type: "readonly RankedBar[]", required: true, desc: ct("app.chart.bars.desc") },
        { name: "limit (RankedBars)", type: "number", def: "6", desc: ct("app.chart.limit.desc") },
        { name: "data (TimeSeries)", type: "readonly TimePoint[]", required: true, desc: ct("app.chart.data.desc") },
        { name: "formatValue (TimeSeries)", type: "(point: TimePoint) => ReactNode", required: true, desc: ct("app.chart.formatValue.desc") },
        { name: "height (TimeSeries)", type: "number", def: "148", desc: "" },
        { name: "markers (TimeSeries)", type: "ReadonlySet<string>", desc: ct("app.chart.markers.desc") },
        { name: "tone", type: '"critical" | "neutral" | "positive" | "warning"', def: '"neutral"', desc: ct("app.chart.tone.desc") },
        { name: "emptyLabel", type: "string", required: true, desc: ct("app.chart.emptyLabel.desc") },
      ],
      demos: [
        {
          id: "chart-ranked",
          title: "RankedBars",
          code: `<RankedBars
  emptyLabel="Sin datos"
  bars={[{ key: "wa", label: "WhatsApp", formatted: "612", value: 612 }]}
/>`,
          render: (
            <div className="w-full max-w-md">
              <RankedBars
                emptyLabel="Sin datos todavía"
                bars={[
                  { key: "wa", label: "WhatsApp", formatted: "612", value: 612 },
                  { key: "ig", label: "Instagram", formatted: "218", value: 218 },
                  { key: "web", label: "Web", formatted: "144", value: 144, tone: "positive" },
                  { key: "form", label: "Formulario", formatted: "29", value: 29 },
                ]}
              />
            </div>
          ),
        },
        {
          id: "chart-series",
          title: "TimeSeries",
          desc: ct("app.chart.series.desc"),
          code: `<TimeSeries
  data={data}
  emptyLabel="Sin actividad"
  formatValue={(point) => \`\${point.value} mensajes · \${point.label}\`}
/>`,
          render: (
            <div className="w-full max-w-lg">
              <TimeSeries
                data={SERIES}
                emptyLabel="Sin actividad"
                formatValue={(point) => `${point.value} mensajes · ${point.label}`}
              />
            </div>
          ),
        },
      ],
    },
    {
      id: "channel-badge",
      name: "ChannelBadge",
      source: "app/_components/channel-badge.tsx",
      importLine: 'import { ChannelBadge, ChannelIcon, ChannelStatusBadge } from "@/app/_components/channel-badge";',
      desc: ct("app.channelBadge.desc"),
      exports: ["ChannelBadge", "ChannelIcon", "ChannelStatusBadge", "CHANNEL_LABELS"],
      props: [
        { name: "channel", type: '"web" | "whatsapp" | "instagram" | "form" | "voice"', required: true, desc: ct("app.channelBadge.channel.desc") },
        { name: "status (StatusBadge)", type: '"connected" | "disconnected" | "error"', desc: "" },
      ],
      demos: [
        {
          id: "channel-badge-all",
          title: ct("app.channelBadge.title"),
          code: '<ChannelBadge channel="whatsapp" />',
          render: (
            <>
              {CHANNELS.map((channel) => (
                <ChannelBadge key={channel} channel={channel} />
              ))}
            </>
          ),
        },
        {
          id: "channel-icon",
          title: ct("app.channelBadge.icon.title"),
          code: '<ChannelIcon channel="instagram" />',
          render: (
            <>
              {CHANNELS.map((channel) => (
                <ChannelIcon key={channel} channel={channel} className="text-muted-foreground" />
              ))}
            </>
          ),
        },
      ],
    },
    {
      id: "prospect-badge",
      name: "ProspectBadge",
      source: "app/_components/prospect-badge.tsx",
      importLine: 'import { ProspectBadge } from "@/app/_components/prospect-badge";',
      desc: ct("app.prospectBadge.desc"),
      props: [
        { name: "prospect", type: "ProspectAssessment | undefined", required: true, desc: ct("app.prospectBadge.prospect.desc") },
      ],
      demos: [
        {
          id: "prospect-badge-stages",
          title: ct("app.prospectBadge.title"),
          code: '<ProspectBadge prospect={conversation.prospect} />',
          render: (
            <>
              {(["won", "negotiating", "interested", "lost", "support"] as const).map((stage) => (
                <ProspectBadge
                  key={stage}
                  prospect={{
                    stage,
                    reason: "Pidió precio y dejó teléfono.",
                    assessedAt: "2026-09-05T10:00:00.000Z",
                    turnCount: 12,
                    source: "ai",
                  }}
                />
              ))}
              <ProspectBadge prospect={undefined} />
            </>
          ),
        },
      ],
    },
    {
      id: "page-container",
      name: "PageContainer",
      source: "app/_components/page-container.tsx",
      importLine: 'import { PageContainer } from "@/app/_components/page-container";',
      desc: ct("app.pageContainer.desc"),
      props: [
        { name: "maxWidth", type: "string", def: '"max-w-5xl"', desc: ct("app.pageContainer.maxWidth.desc") },
        { name: "pattern", type: '"grid" | "crosses" | "diagonals" | "brackets" | "none"', def: '"grid"', desc: ct("app.pageContainer.pattern.desc") },
      ],
      demos: [
        {
          id: "page-container-patterns",
          title: ct("app.pageContainer.title"),
          desc: ct("app.pageContainer.desc2"),
          surface: "page",
          code: '<PageContainer pattern="crosses" maxWidth="max-w-xl">…</PageContainer>',
          render: (
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
              {(["grid", "crosses", "diagonals", "brackets"] as const).map((pattern) => (
                <div
                  key={pattern}
                  className="relative h-24 overflow-hidden rounded-xl border border-border bg-background"
                >
                  <div
                    className={`pointer-events-none absolute inset-0 opacity-30 bg-pattern bg-pattern-${pattern} bg-pattern-fade`}
                  />
                  <span className="absolute bottom-2 left-2 font-mono text-[10.5px] text-muted-foreground">
                    {pattern}
                  </span>
                </div>
              ))}
            </div>
          ),
        },
      ],
    },
    {
      id: "misc-app",
      name: ct("app.misc.name"),
      source: "app/_components/",
      importLine: 'import { … } from "@/app/_components/…";',
      desc: ct("app.misc.desc"),
      exports: [
        "AppShell",
        "AgentChat",
        "AgentMessage",
        "BusinessSwitcher",
        "BusinessesCard",
        "ContactDialog",
        "CredentialField",
        "FeaturesDialog",
        "SoundSettings",
        "TutorialVideoDialog",
        "WebhookUrlNote",
        "AdsRows",
        "DockReopenButton",
      ],
      demos: [
        {
          id: "misc-app-note",
          title: ct("app.misc.title"),
          code: "ls app/_components/",
          render: (
            <p className="text-sm text-muted-foreground">
              Cada uno se ve en su pantalla: el chat en{" "}
              <code className="font-mono text-xs">/agents/[id]</code>, el selector de negocio en la
              barra lateral, CredentialField en{" "}
              <code className="font-mono text-xs">/settings</code>.
            </p>
          ),
        },
      ],
    },
  ],
  };
}
