"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Loading03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Card, CardHeader, CardTitle, CardDescription, CardSeparator } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { type AdminOverview, type AdminTenant, lastDeployFailed, tenantNeedsAttention } from "@/lib/admin-types";
import { adminOverviewStats, isPayingTenant } from "@/lib/admin-overview";
import { cn } from "@/lib/utils";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, Stat, useAdminHref, useAdminNow } from "./admin-shell";
import { CHANNEL_LABEL, STATUS_VARIANT, channelTone, formatUsd, releaseVariant, shortSha, tickTone } from "./format";

type Filter = "all" | "beta" | "subscription" | "attention" | "test";

const FILTERS: ReadonlyArray<{ id: Filter; es: string; en: string }> = [
  { id: "all", es: "Todos", en: "All" },
  { id: "beta", es: "Beta", en: "Beta" },
  { id: "subscription", es: "Pagando", en: "Paying" },
  { id: "attention", es: "Atención", en: "Attention" },
  { id: "test", es: "Pruebas", en: "Test" },
];

function matcher(id: Filter, salesEnabled: boolean, now: number): (t: AdminTenant) => boolean {
  switch (id) {
    case "beta":
      return (t) => !t.isTest && t.status !== "deleted" && (t.access === "beta" || !salesEnabled);
    case "subscription":
      return (t) => isPayingTenant(t, salesEnabled);
    case "attention":
      return (t) => tenantNeedsAttention(t, now);
    case "test":
      return (t) => t.isTest;
    default:
      return () => true;
  }
}

export function TenantsOverview({ overview, salesEnabled }: { readonly overview: AdminOverview; readonly salesEnabled: boolean }) {
  const router = useRouter();
  const href = useAdminHref();
  const now = useAdminNow();
  const { locale, tr, fmt, labels } = useAdminLocale();
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const tenants = overview.tenants;

  const stats = useMemo(() => adminOverviewStats(tenants, salesEnabled, now), [tenants, salesEnabled, now]);

  const visible = useMemo(() => {
    const match = matcher(filter, salesEnabled, now);
    const needle = query.trim().toLowerCase();
    return tenants.filter(
      (t) =>
        match(t) &&
        (!needle || [t.slug, t.domain, t.ownerEmail, t.id].some((value) => value.toLowerCase().includes(needle))),
    );
  }, [tenants, filter, salesEnabled, now, query]);

  return (
    <div className="content-enter space-y-6">
      <PageHeader
        title={tr("Clientes", "Customers")}
        description={`${tr("Cada instalación alojada, desde el registro del fleet", "Every hosted install, from the fleet registry")} · ${fmt.dateTime(overview.generatedAt)}`}
        actions={
          <Button size="sm" variant="secondary" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
            <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.75} className={cn(refreshing && "animate-spin")} />
            {tr("Actualizar", "Refresh")}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={tr("Clientes activos", "Live customers")}
          value={fmt.number(stats.live)}
          hint={tr(
            `${fmt.number(stats.total)} clientes · ${fmt.number(stats.tests)} de prueba aparte`,
            `${fmt.number(stats.total)} customers · ${fmt.number(stats.tests)} test installs apart`,
          )}
        />
        <Stat
          label={tr("En beta", "In beta")}
          value={fmt.number(stats.beta)}
          hint={tr(`${formatUsd(stats.betaValue)}/mes sin cobrar`, `${formatUsd(stats.betaValue)}/mo not billed`)}
        />
        <Stat
          label={tr("Pagando", "Paying")}
          value={fmt.number(stats.paying)}
          hint={salesEnabled ? fmt.revenue(stats.revenue) : tr("Ventas cerradas · beta privada", "Sales closed · private beta")}
        />
        <Stat
          label={tr("IA · 30 días", "AI · 30 days")}
          value={formatUsd(stats.usage.cost)}
          hint={tr(
            `${fmt.number(stats.usage.credits)} créditos · Oruka pagó ${formatUsd(stats.usage.included)}`,
            `${fmt.number(stats.usage.credits)} credits · Oruka paid ${formatUsd(stats.usage.included)}`,
          )}
        />
        <Stat
          label={tr("Atención", "Attention")}
          value={fmt.number(stats.attention)}
          hint={
            stats.attention
              ? tr("tick fallando o atrasado, deploy, config o pago", "failing or late tick, deploy, config or payment")
              : tr("todo en orden", "all good")
          }
          tone={stats.attention ? "warning" : "ok"}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr("Filtrar clientes", "Filter customers")}>
            {FILTERS.map((f) => (
              <ToggleChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
                {locale === "en" ? f.en : f.es}
                <span className="tabular-nums text-muted-foreground">{tenants.filter(matcher(f.id, salesEnabled, now)).length}</span>
              </ToggleChip>
            ))}
          </div>
          <div className="relative sm:w-64">
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("Buscar por subdominio o email", "Search by subdomain or email")}
              aria-label={tr("Buscar clientes", "Search customers")}
              className="pl-8"
            />
          </div>
        </div>
        <CardSeparator />
        {visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {tenants.length === 0
              ? tr("Todavía no hay clientes en el registro.", "No customers in the registry yet.")
              : tr("Ningún cliente coincide.", "No customer matches.")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((tenant) => (
              <li key={tenant.id}>
                <TenantRow tenant={tenant} salesEnabled={salesEnabled} href={href(`/tenants/${tenant.id}`)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1">
            <CardTitle>Releases</CardTitle>
            <CardDescription>
              {tr("Producción", "Production")}: <span className="font-mono">{shortSha(overview.productionCommit)}</span> ·{" "}
              {tr("los nuevos clientes se crean desde este commit", "new customers are created from this commit")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardSeparator />
        {overview.releases.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{tr("Sin releases registrados.", "No releases recorded.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {overview.releases.map((release) => (
              <li key={release.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground">#{release.id}</span>
                <span className="font-mono text-xs">{shortSha(release.sha)}</span>
                <span className="text-muted-foreground">{release.rollbackOf ? "rollback" : release.target}</span>
                <StatusBadge status={releaseVariant(release.status)} label={labels.release[release.status]} />
                <span className="ml-auto text-xs text-muted-foreground" title={fmt.dateTime(release.createdAt)}>
                  {fmt.relative(release.createdAt, now)}
                </span>
                {release.error ? <p className="w-full truncate text-xs text-destructive">{release.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TenantRow({ tenant, href, salesEnabled }: { readonly tenant: AdminTenant; readonly href: string; readonly salesEnabled: boolean }) {
  const now = useAdminNow();
  const { tr, fmt, labels } = useAdminLocale();
  const channels = (["whatsapp", "instagram"] as const).map((id) => ({ id, state: tenant.channelStates?.[id]?.state }));
  const access = tenant.isTest ? "test" : tenant.access === "beta" || !salesEnabled ? "beta" : "subscription";
  return (
    <Link
      href={href}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)]"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {tenant.slug}
          {tenant.isTest ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">test</span>
          ) : null}
          {tenantNeedsAttention(tenant, now) ? (
            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" role="img" aria-label={tr("Necesita atención", "Needs attention")} />
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{tenant.ownerEmail}</p>
      </div>

      <div className="flex flex-col items-end gap-1 md:items-start">
        <span className="text-sm">
          {labels.plan[tenant.effectivePlan]}
          <span className="text-muted-foreground"> · {labels.access[access]}</span>
        </span>
        <StatusBadge status={STATUS_VARIANT[tenant.status]} label={labels.status[tenant.status]} />
      </div>

      <div className="hidden items-center gap-3 md:flex">
        {channels.map((channel) => (
          <span
            key={channel.id}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={`${CHANNEL_LABEL[channel.id]}: ${labels.channelState[channel.state ?? "disconnected"] ?? channel.state}`}
          >
            <span className={cn("size-1.5 rounded-full", channelTone(channel.state))} />
            {channel.id === "whatsapp" ? "WA" : "IG"}
          </span>
        ))}
      </div>

      <div className="hidden text-xs md:block">
        {tenant.usage ? (
          <>
            <p className="tabular-nums">{fmt.count(tenant.usage.credits, ["crédito", "créditos"], ["credit", "credits"])}</p>
            <p className="tabular-nums text-muted-foreground">
              {formatUsd(tenant.usage.providerCost)} · {fmt.count(tenant.usage.calls, ["llamada", "llamadas"], ["call", "calls"])}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{tr("Sin datos de uso", "No usage data")}</p>
        )}
      </div>

      <div className="hidden text-xs md:block">
        <p className={tickTone(tenant, now)} title={fmt.dateTime(tenant.tickSucceededAt)}>
          {tenant.tickFailures > 0
            ? tr(`${tenant.tickFailures} ticks fallidos`, `${tenant.tickFailures} failed ticks`)
            : `tick ${fmt.relative(tenant.tickSucceededAt, now)}`}
        </p>
        <p className="text-muted-foreground">
          <span className="font-mono">{shortSha(tenant.deployedCommit)}</span>
          {lastDeployFailed(tenant) ? <span className="ml-1.5 text-destructive">{tr("deploy falló", "deploy failed")}</span> : null}
          {tenant.configBehind ? (
            <span className="ml-1.5 text-amber-600 dark:text-amber-400">
              {tr(`config v${tenant.configVersion} pendiente`, `config v${tenant.configVersion} pending`)}
            </span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
