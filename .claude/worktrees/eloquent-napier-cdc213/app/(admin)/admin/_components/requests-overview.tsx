"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { Card, CardSeparator } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { REQUEST_SOURCES, REQUEST_STATUSES, type AccessRequestFilters, type AccessRequestsOverview } from "@/lib/access-request-types";
import { cn } from "@/lib/utils";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, Stat, useAdminHref } from "./admin-shell";

export function RequestsOverview({ overview, filters }: {
  overview: AccessRequestsOverview; filters: AccessRequestFilters;
}) {
  const href = useAdminHref();
  const router = useRouter();
  const { tr, fmt, labels } = useAdminLocale();
  const [refreshing, startRefresh] = useTransition();
  const pageHref = (page: number) => `${href("/requests")}?${new URLSearchParams({ source: filters.source, status: filters.status, q: filters.query, page: String(page) })}`;
  return <div className="content-enter space-y-6">
    <PageHeader
      title={tr("Solicitudes", "Requests")}
      description={tr("Acceso a la beta privada y consultas recibidas desde la web.", "Private beta access and inquiries sent from the website.")}
      actions={<Button size="sm" variant="secondary" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
        <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.75} className={cn(refreshing && "animate-spin")} />
        {tr("Actualizar", "Refresh")}
      </Button>}
    />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label={tr("Beta privada", "Private beta")} value={fmt.number(overview.stats.beta)} />
      <Stat label={tr("Beta pendiente", "Beta pending")} value={fmt.number(overview.stats.pendingBeta)} />
      <Stat label={tr("Solicitudes abiertas", "Open requests")} value={fmt.number(overview.stats.open)} />
      <Stat
        label={tr("Avisos por correo fallidos", "Failed email notices")}
        value={fmt.number(overview.stats.failedNotifications)}
        tone={overview.stats.failedNotifications ? "warning" : "ok"}
      />
    </div>
    {overview.stats.failedNotifications > 0 ? <Alert tone="warning" title={tr("Hay solicitudes guardadas cuyo aviso por correo falló", "Some saved requests have a failed email notice")}>
      {tr(
        "Ábrelas para reenviar el aviso. No hace falta que la persona vuelva a enviar el formulario.",
        "Open them to send the notice again. The person does not need to submit the form again.",
      )}
    </Alert> : null}
    <Card>
      <form key={`${filters.source}:${filters.status}:${filters.query}`} action={href("/requests")} method="get" className="grid gap-3 p-4 sm:grid-cols-2 sm:items-end lg:grid-cols-[1fr_1fr_2fr_auto]">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="request-source" className="text-xs text-muted-foreground">{tr("Origen", "Source")}</label>
          <Select name="source" defaultValue={filters.source}>
            <SelectTrigger id="request-source" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">{tr("Todos los formularios", "Every form")}</SelectItem>
              {REQUEST_SOURCES.map((value) => <SelectItem key={value} value={value}>{labels.requestSource[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="request-status" className="text-xs text-muted-foreground">{tr("Estado", "Status")}</label>
          <Select name="status" defaultValue={filters.status}>
            <SelectTrigger id="request-status" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">{tr("Todos los estados", "Every status")}</SelectItem>
              {REQUEST_STATUSES.map((value) => <SelectItem key={value} value={value}>{labels.requestStatus[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="request-query" className="text-xs text-muted-foreground">{tr("Buscar", "Search")}</label>
          <Input id="request-query" name="q" type="search" maxLength={200} defaultValue={filters.query} placeholder={tr("Nombre, empresa o email…", "Name, company or email…")} autoComplete="off" />
        </div>
        <Button type="submit" variant="secondary">{tr("Filtrar", "Filter")}</Button>
      </form>
      <CardSeparator />
      {overview.requests.length === 0 ? <div className="px-5 py-12 text-center">
        <p className="text-sm">{filters.query || filters.status !== "all"
          ? tr("No hay solicitudes con estos filtros.", "No requests match these filters.")
          : tr("Todavía no hay solicitudes de este origen.", "No requests from this source yet.")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{tr("Las nuevas solicitudes aparecerán aquí al recibir el formulario.", "New requests show up here as forms arrive.")}</p>
      </div> : <ul className="divide-y divide-border">
        {overview.requests.map((request) => <li key={request.id}>
          <Link href={href(`/requests/${request.id}`)} className="grid gap-2 px-5 py-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{request.company} <span className="font-normal text-muted-foreground">· {request.name}</span></p>
              <p className="truncate text-xs text-muted-foreground">{request.email} · {labels.requestSource[request.source]}</p>
              {request.message ? <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">{request.message}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              <StatusBadge status={request.status === "pending" ? "pending" : request.status === "contacted" ? "in-progress" : "success"} label={labels.requestStatus[request.status]} />
              <span className="text-xs text-muted-foreground">{fmt.dateTime(request.createdAt)}</span>
              {request.notification === "failed" ? <span className="text-xs text-amber-600 dark:text-amber-400">{tr("Aviso por correo fallido", "Email notice failed")}</span> : null}
            </div>
          </Link>
        </li>)}
      </ul>}
      <CardSeparator />
      <nav aria-label={tr("Páginas de solicitudes", "Request pages")} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground">
        <p>{tr(
          `${fmt.number(overview.total)} solicitudes · Página ${overview.page} de ${overview.pages}`,
          `${fmt.number(overview.total)} requests · Page ${overview.page} of ${overview.pages}`,
        )}</p>
        <div className="flex gap-4">
          {overview.page > 1 ? <Link href={pageHref(overview.page - 1)} className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{tr("Anterior", "Previous")}</Link> : null}
          {overview.page < overview.pages ? <Link href={pageHref(overview.page + 1)} className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{tr("Siguiente", "Next")}</Link> : null}
        </div>
      </nav>
    </Card>
    <p className="text-xs text-muted-foreground">{tr(
      "Las solicitudes enviadas antes de habilitar este registro permanecen en el correo.",
      "Requests sent before this log existed stay in the inbox.",
    )}</p>
  </div>;
}
