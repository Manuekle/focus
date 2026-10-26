"use client";

import Link from "next/link";
import { Card, CardSeparator } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Alert } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVITY_AREAS, ACTIVITY_AREA_LABEL, ACTIVITY_AREA_LABEL_EN, type ActivityArea, type ActivityItem } from "@/lib/admin-activity";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref, useAdminNow } from "./admin-shell";

export type ActivityFilters = { area: ActivityArea | "all"; actor: string; from: string; to: string };

export function ActivityLog({ items, next, filters, operators, fleetError, paged }: {
  readonly items: readonly ActivityItem[];
  readonly next: string | null;
  readonly filters: ActivityFilters;
  readonly operators: readonly string[];
  readonly fleetError: string | null;
  readonly paged: boolean;
}) {
  const href = useAdminHref();
  const now = useAdminNow();
  const { locale, tr, fmt } = useAdminLocale();
  const areaLabel = locale === "en" ? ACTIVITY_AREA_LABEL_EN : ACTIVITY_AREA_LABEL;
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const pickerLabels = {
    placeholder: tr("Cualquier día", "Any day"),
    previousMonth: tr("Mes anterior", "Previous month"),
    nextMonth: tr("Mes siguiente", "Next month"),
    clear: tr("Quitar", "Clear"),
    today: tr("Hoy", "Today"),
  };
  const query = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...extra })) if (value && value !== "all") params.set(key, value);
    const text = params.toString();
    return `${href("/security/activity")}${text ? `?${text}` : ""}`;
  };
  const filtered = filters.area !== "all" || filters.actor || filters.from || filters.to;

  return <div className="content-enter space-y-6">
    <PageHeader
      back={{ href: href("/security"), label: tr("Seguridad", "Security") }}
      title={tr("Actividad", "Activity")}
      description={tr(
        "Lo que hizo cada operador en clientes, solicitudes, anuncios y despliegues, lo más nuevo primero. Sin notas internas, textos de anuncios ni secretos.",
        "What each operator did in customers, requests, announcements and deployments, newest first. No internal notes, announcement copy or secrets.",
      )}
    />
    {fleetError ? <Alert tone="warning" title={tr("Actividad del fleet no disponible", "Fleet activity unavailable")}>{fleetError}</Alert> : null}
    <Card>
      <form key={`${filters.area}:${filters.actor}:${filters.from}:${filters.to}`} action={href("/security/activity")} method="get"
        className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto] lg:items-end">
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <label htmlFor="activity-area">{tr("Área", "Area")}</label>
          <Select name="area" defaultValue={filters.area}>
            <SelectTrigger id="activity-area" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">{tr("Todas", "All")}</SelectItem>
              {ACTIVITY_AREAS.map((area) => <SelectItem key={area} value={area}>{areaLabel[area]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <label htmlFor="activity-actor">{tr("Operador", "Operator")}</label>
          <Select name="actor" defaultValue={filters.actor || "all"}>
            <SelectTrigger id="activity-actor" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">{tr("Todos", "All")}</SelectItem>
              {operators.map((email) => <SelectItem key={email} value={email}>{email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <label htmlFor="activity-from">{tr("Desde", "From")}</label>
          <DatePicker id="activity-from" name="from" locale={locale} labels={pickerLabels} value={from} max={to || undefined} onChange={setFrom} />
        </div>
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <label htmlFor="activity-to">{tr("Hasta", "To")}</label>
          <DatePicker id="activity-to" name="to" locale={locale} labels={pickerLabels} value={to} min={from || undefined} onChange={setTo} />
        </div>
        <Button type="submit" variant="secondary">{tr("Filtrar", "Filter")}</Button>
      </form>
      <CardSeparator />
      {items.length === 0 ? <div className="px-5 py-12 text-center">
        <p className="text-sm">{filtered
          ? tr("No hay actividad con estos filtros.", "No activity matches these filters.")
          : tr("Todavía no hay actividad registrada.", "No activity recorded yet.")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{tr(
          "Cada cambio de plan, admisión, anuncio o despliegue aparece aquí con su operador.",
          "Every plan change, admission, announcement or deployment shows up here with its operator.",
        )}</p>
      </div> : <ol className="divide-y divide-border">
        {items.map((item, index) => {
          const body = <>
            <div className="min-w-0">
              <p className="break-words text-sm">{item.title}</p>
              {item.detail ? <p className="mt-0.5 break-words text-xs text-muted-foreground">{item.detail}</p> : null}
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {item.actor ?? tr("CLI del fleet", "Fleet CLI")} · {areaLabel[item.area]}
              </p>
            </div>
            <time dateTime={item.at} title={fmt.dateTime(item.at)} className="shrink-0 text-xs text-muted-foreground">
              {fmt.relative(item.at, now)}
            </time>
          </>;
          const row = "flex items-start justify-between gap-4 px-5 py-3.5";
          return <li key={`${item.at}:${index}`}>
            {item.path
              ? <Link href={href(item.path)} className={`${row} transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}>{body}</Link>
              : <div className={row}>{body}</div>}
          </li>;
        })}
      </ol>}
      {next || paged ? <>
        <CardSeparator />
        <div className="flex flex-wrap justify-between gap-2 p-4">
          {paged ? <Button size="sm" variant="secondary" asChild><Link href={query()}>{tr("Lo más reciente", "Newest")}</Link></Button> : <span />}
          {next ? <Button size="sm" variant="secondary" asChild><Link href={query({ before: next })}>{tr("Más antiguo", "Older")}</Link></Button> : null}
        </div>
      </> : null}
    </Card>
  </div>;
}
