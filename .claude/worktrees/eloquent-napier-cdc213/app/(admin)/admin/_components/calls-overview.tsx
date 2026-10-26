"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Calendar03Icon, Copy01Icon, LinkSquare02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { Card, CardSeparator } from "@/app/_components/dashboard-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import { CALL_FILTERS, type CallsFilters, type CallsState } from "@/lib/admin-calls-types";
import { cn } from "@/lib/utils";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref } from "./admin-shell";

const STATUSES: Record<string, { es: string; en: string; variant: StatusVariant }> = {
  accepted: { es: "Confirmada", en: "Confirmed", variant: "success" }, pending: { es: "Por confirmar", en: "Unconfirmed", variant: "pending" },
  cancelled: { es: "Cancelada", en: "Cancelled", variant: "expired" }, rejected: { es: "Rechazada", en: "Rejected", variant: "failed" },
};
const ERRORS: Record<"credentials" | "rate_limit" | "unavailable" | "configuration", readonly [string, string]> = {
  credentials: ["Cal.com no aceptó la API key. Revisa que siga vigente y tenga acceso a tus reservas.", "Cal.com refused the API key. Check it is still valid and can read your bookings."],
  rate_limit: ["Cal.com alcanzó su límite de consultas. Espera un momento y actualiza.", "Cal.com hit its rate limit. Wait a moment and refresh."],
  unavailable: ["No pudimos consultar Cal.com. Vuelve a actualizar en unos instantes.", "We could not reach Cal.com. Refresh again in a moment."],
  configuration: ["Revisa CALCOM_API_KEY y CALCOM_EVENT_TYPE_IDS en el entorno del servidor.", "Check CALCOM_API_KEY and CALCOM_EVENT_TYPE_IDS in the server environment."],
};

export function CallsOverview({ result, filters, bookingUrl }: {
  result: CallsState; filters: CallsFilters; bookingUrl: string | null;
}) {
  const href = useAdminHref();
  const router = useRouter();
  const { locale, tr, fmt, labels } = useAdminLocale();
  const [refreshing, startRefresh] = useTransition();
  const [copyMessage, setCopyMessage] = useState("");
  const configured = result.state !== "not_configured";
  useEffect(() => {
    if (!configured) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") startRefresh(() => router.refresh());
    }, 60_000);
    return () => clearInterval(timer);
  }, [configured, router]);
  const listHref = (cursor: string | null = null, status: CallsFilters["status"] = filters.status) => `${href("/calls")}?${new URLSearchParams({ status, ...(filters.attendeeEmail ? { attendeeEmail: filters.attendeeEmail } : {}), ...(cursor ? { cursor } : {}) })}`;
  const copyLink = async () => {
    if (!bookingUrl) return;
    try { await navigator.clipboard.writeText(bookingUrl); setCopyMessage(tr("Enlace copiado.", "Link copied.")); }
    catch { setCopyMessage(tr("No se pudo copiar. Abre el enlace y cópialo desde el navegador.", "Could not copy. Open the link and copy it from the browser.")); }
  };
  return <div className="content-enter space-y-6">
    <PageHeader
      title={tr("Llamadas", "Calls")}
      description={tr("Reservas de Cal.com · Horarios de Bogotá.", "Cal.com bookings · Bogotá times.")}
      actions={<>
        <Button size="sm" variant="secondary" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
          <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.75} className={cn(refreshing && "animate-spin")} />
          {tr("Actualizar", "Refresh")}
        </Button>
        <Button asChild size="sm" variant="outline"><a href="https://app.cal.com/bookings/upcoming" target="_blank" rel="noopener noreferrer">{tr("Gestionar en Cal.com", "Manage in Cal.com")} <HugeiconsIcon icon={LinkSquare02Icon} size={14} strokeWidth={1.75} /></a></Button>
      </>}
    />
    {bookingUrl ? <Card className="grid gap-3 p-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{tr("Tu enlace para agendar", "Your booking link")}</h2>
        <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all rounded text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{bookingUrl}</a>
      </div>
      <Button size="sm" variant="secondary" className="w-fit" onClick={() => void copyLink()}><HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} /> {tr("Copiar enlace", "Copy link")}</Button>
      <p role="status" className={copyMessage ? "w-full text-xs text-muted-foreground" : "sr-only"}>{copyMessage}</p>
    </Card> : null}
    {result.state === "not_configured" ? <Card className="space-y-4 p-6">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><HugeiconsIcon icon={Calendar03Icon} size={20} strokeWidth={1.75} /></div>
      <div><h2 className="text-sm font-medium">{tr("Conecta tu agenda de Cal.com", "Connect your Cal.com calendar")}</h2><p className="mt-1 max-w-lg text-sm text-muted-foreground">{tr("Cuando alguien reserve una llamada, aparecerá aquí con sus datos, horario y enlace a la reunión.", "When someone books a call it shows up here with their details, time and meeting link.")}</p></div>
      <div className="rounded-xl bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
        <p>{tr("En el entorno del servidor:", "In the server environment:")}</p>
        <ul className="mt-2 space-y-1">
          <li><code className="text-foreground">CALCOM_API_KEY</code> — {tr("tu API key de Cal.com.", "your Cal.com API key.")}</li>
          <li><code className="text-foreground">CALCOM_BOOKING_URL</code> — {tr("el enlace público de tu evento.", "the public link to your event.")}</li>
        </ul>
        <p className="mt-2">{tr("Guarda los valores y vuelve a desplegar para activar la conexión.", "Save the values and deploy again to turn the connection on.")}</p>
      </div>
      <Button asChild size="sm" variant="secondary"><a href="https://app.cal.com/settings/developer/api-keys" target="_blank" rel="noopener noreferrer">{tr("Obtener API key", "Get an API key")} <HugeiconsIcon icon={LinkSquare02Icon} size={14} strokeWidth={1.75} /></a></Button>
    </Card> : <>
      {result.state === "error" ? <Alert tone="warning" title={tr("No se pudieron cargar las llamadas", "Calls could not be loaded")}>{tr(...ERRORS[result.reason])}</Alert> : null}
      <Card aria-busy={refreshing}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <label htmlFor="calls-status" className="text-xs text-muted-foreground">{tr("Mostrar", "Show")}</label>
            <Select value={filters.status} onValueChange={(status) => startRefresh(() => router.push(listHref(null, status as CallsFilters["status"])))} disabled={refreshing}>
              <SelectTrigger id="calls-status" className="min-w-36"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" align="start">{CALL_FILTERS.map((status) => <SelectItem key={status} value={status}>{labels.callFilter[status]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{tr("Actualización automática cada minuto", "Refreshes every minute")}</p>
        </div>
        <form key={filters.attendeeEmail ?? "all"} className="flex flex-wrap items-end gap-2 px-4 pb-4" onSubmit={(event) => {
          event.preventDefault();
          const email = String(new FormData(event.currentTarget).get("attendeeEmail") ?? "").trim();
          startRefresh(() => router.push(`${href("/calls")}?${new URLSearchParams({ status: filters.status, ...(email ? { attendeeEmail: email } : {}) })}`));
        }}>
          <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-xs">
            <label htmlFor="calls-email" className="text-xs text-muted-foreground">{tr("Email del contacto", "Contact email")}</label>
            <Input id="calls-email" name="attendeeEmail" type="email" maxLength={320} autoComplete="off" spellCheck={false} defaultValue={filters.attendeeEmail ?? ""} placeholder={tr("nombre@empresa.com", "name@company.com")} disabled={refreshing} />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={refreshing}>{tr("Buscar llamadas", "Find calls")}</Button>
          {filters.attendeeEmail ? <Button asChild size="sm" variant="ghost"><Link href={`${href("/calls")}?${new URLSearchParams({ status: filters.status })}`}>{tr("Quitar filtro", "Clear filter")}</Link></Button> : null}
        </form>
        <CardSeparator />
        {result.state === "connected" ? result.page.calls.length === 0 ? <div className="space-y-2 px-5 py-12 text-center">
          <p className="text-sm">{tr("No hay llamadas en esta vista.", "No calls in this view.")}</p>
          <p className="text-xs text-muted-foreground">{tr("Las nuevas reservas aparecerán al actualizar la agenda.", "New bookings show up when the calendar refreshes.")}</p>
        </div> : <ul className="divide-y divide-border">
          {result.page.calls.map((call) => {
            const known = call.rescheduled ? { es: "Reprogramada", en: "Rescheduled", variant: "expired" as const } : STATUSES[call.status] ?? { es: "Otro estado", en: "Other status", variant: "draft" as const };
            const status = { label: locale === "en" ? known.en : known.es, variant: known.variant };
            const joinable = call.status === "accepted" && !call.rescheduled;
            return <li key={call.uid} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 space-y-2">
                <h2 className="break-words text-sm font-medium">{call.title || tr("Llamada", "Call")}</h2>
                <p className="text-xs tabular-nums text-muted-foreground"><time dateTime={call.start}>{fmt.dateTime(call.start)}</time> · {Math.round((Date.parse(call.end) - Date.parse(call.start)) / 60_000)} min</p>
                <ul className="space-y-1 text-sm">{call.attendees.map((attendee, index) => <li key={`${attendee.email}:${index}`} className="break-words">
                  {attendee.name} <span className="break-all text-xs text-muted-foreground">{attendee.email}</span>
                  {attendee.email ? <Link href={`${href("/requests")}?${new URLSearchParams({ source: "all", q: attendee.email })}`} className="ml-2 inline-block whitespace-nowrap rounded text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{tr("Buscar solicitud", "Find request")}</Link> : null}
                </li>)}</ul>
                {call.cancellationReason ? <p className="break-words text-xs text-muted-foreground">{tr("Motivo", "Reason")}: {call.cancellationReason}</p> : null}
                {!call.meetingUrl && call.location ? <p className="break-words text-xs text-muted-foreground">{tr("Lugar", "Location")}: {call.location}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-end">
                <StatusBadge status={status.variant} label={status.label} />
                {call.meetingUrl && joinable ? <Button asChild size="sm" variant="outline"><a href={call.meetingUrl} target="_blank" rel="noopener noreferrer">{tr("Abrir reunión", "Open meeting")} <HugeiconsIcon icon={LinkSquare02Icon} size={14} strokeWidth={1.75} /></a></Button> : null}
              </div>
            </li>;
          })}
        </ul> : <p className="p-5 text-sm text-muted-foreground">{tr("Actualiza para volver a consultar tu agenda.", "Refresh to read your calendar again.")}</p>}
        {result.state === "connected" ? <><CardSeparator />
          <nav aria-label={tr("Páginas de llamadas", "Call pages")} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground">
            <p>{tr("Consultado", "Fetched")}: {fmt.dateTime(result.page.fetchedAt)}</p>
            <div className="flex gap-4">
              {filters.cursor ? <Link className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" href={listHref()}>{tr("Primera página", "First page")}</Link> : null}
              {result.page.nextCursor ? <Link className="rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" href={listHref(result.page.nextCursor)}>{tr("Siguiente", "Next")}</Link> : null}
            </div>
          </nav>
        </> : null}
      </Card>
    </>}
  </div>;
}
