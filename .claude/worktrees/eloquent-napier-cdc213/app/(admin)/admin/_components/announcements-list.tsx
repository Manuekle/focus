"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Megaphone01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { AnnouncementKindBadge } from "@/components/announcements/announcement-body";
import { Card, CardSeparator } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { AdminAnnouncement } from "@/lib/admin-types";
import { cn } from "@/lib/utils";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref, useAdminNow } from "./admin-shell";
import { ANNOUNCEMENT_STATUS_VARIANT, clickRate, liveState } from "./format";

type Filter = "all" | AdminAnnouncement["status"];

const FILTERS: ReadonlyArray<{ id: Filter; es: string; en: string }> = [
  { id: "all", es: "Todos", en: "All" },
  { id: "published", es: "Publicados", en: "Published" },
  { id: "draft", es: "Borradores", en: "Drafts" },
  { id: "archived", es: "Archivados", en: "Archived" },
];

/** Whether one language's copy is ready to publish: a title and a text. */
export function copyComplete(copy: { title: string; body: string } | undefined): boolean {
  return Boolean(copy?.title.trim() && copy.body.trim());
}

export function AnnouncementsList({ announcements }: { readonly announcements: readonly AdminAnnouncement[] }) {
  const href = useAdminHref();
  const { locale, tr } = useAdminLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(
    () => announcements.filter((a) => filter === "all" || a.status === filter),
    [announcements, filter],
  );

  return (
    <div className="content-enter space-y-6">
      <PageHeader
        title={tr("Anuncios", "Announcements")}
        description={tr(
          "Novedades, promociones y avisos que tus clientes ven al abrir la app, en español y en inglés. Se entregan con la configuración de cada cliente: sin deploy, en segundos.",
          "New features, offers and notices your customers see when they open the app, in Spanish and English. They ride each customer's configuration: no deploy, in seconds.",
        )}
        actions={
          <Button size="sm" asChild>
            <Link href={href("/announcements/new")}>
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
              {tr("Nuevo anuncio", "New announcement")}
            </Link>
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-1.5 p-4" role="group" aria-label={tr("Filtrar anuncios", "Filter announcements")}>
          {FILTERS.map((f) => (
            <ToggleChip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
              {locale === "en" ? f.en : f.es}
              <span className="tabular-nums text-muted-foreground">
                {f.id === "all" ? announcements.length : announcements.filter((a) => a.status === f.id).length}
              </span>
            </ToggleChip>
          ))}
        </div>
        <CardSeparator />
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={Megaphone01Icon} size={20} strokeWidth={1.75} />
            </span>
            <p className="text-sm text-muted-foreground">
              {announcements.length === 0
                ? tr("Todavía no escribiste ningún anuncio.", "You have not written an announcement yet.")
                : tr("Ningún anuncio en este filtro.", "No announcement in this filter.")}
            </p>
            {announcements.length === 0 ? (
              <Button size="sm" variant="secondary" asChild>
                <Link href={href("/announcements/new")}>{tr("Escribir el primero", "Write the first one")}</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((announcement) => (
              <li key={announcement.id}>
                <Row announcement={announcement} href={href(`/announcements/${announcement.id}`)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ announcement, href }: { readonly announcement: AdminAnnouncement; readonly href: string }) {
  const now = useAdminNow();
  const { locale, tr, fmt, labels } = useAdminLocale();
  const live = liveState(announcement, now);
  const { stats } = announcement;
  const title =
    (locale === "en" ? announcement.content.en?.title : announcement.content.es.title)?.trim() ||
    announcement.content.es.title.trim() ||
    announcement.content.en?.title.trim() ||
    tr("Sin título", "Untitled");
  return (
    <Link
      href={href}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <AnnouncementKindBadge kind={announcement.kind} label={labels.kind[announcement.kind]} />
          <p className="truncate text-sm font-medium">{title}</p>
        </div>
        <p className="flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">
          <LanguageMarks es={copyComplete(announcement.content.es)} en={copyComplete(announcement.content.en)} />
          <span className="truncate">
            {fmt.audience(announcement.audience)} · {fmt.count(announcement.reach, ["cliente", "clientes"], ["customer", "customers"])}
          </span>
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 text-xs md:items-start">
        <StatusBadge
          status={ANNOUNCEMENT_STATUS_VARIANT[announcement.status]}
          label={live && live !== "live" ? labels.live[live] : labels.announcementStatus[announcement.status]}
        />
        <p className="text-muted-foreground" title={fmt.dateTime(announcement.publishedAt ?? announcement.updatedAt)}>
          {schedule(announcement, now, tr, fmt)}
        </p>
      </div>

      <div className="col-span-2 text-xs md:col-span-1">
        {announcement.status === "draft" && !announcement.publishedAt ? (
          <p className="text-muted-foreground">
            {tr("Editado", "Edited")} {fmt.relative(announcement.updatedAt, now)}
          </p>
        ) : (
          <>
            <p className="tabular-nums">
              {fmt.count(stats.seen, ["vista", "vistas"], ["view", "views"])} · {fmt.count(stats.clicked, ["clic", "clics"], ["click", "clicks"])}
              <span className="text-muted-foreground"> · {clickRate(stats)}</span>
            </p>
            <p className="tabular-nums text-muted-foreground">
              {tr(`${fmt.number(stats.dismissed)} cerrados sin abrir`, `${fmt.number(stats.dismissed)} closed without opening`)}
            </p>
          </>
        )}
      </div>
    </Link>
  );
}

/** ES · EN marks: solid when that language is complete, hollow while it is missing. */
export function LanguageMarks({ es, en }: { readonly es: boolean; readonly en: boolean }) {
  const { tr } = useAdminLocale();
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label={tr(`Español ${es ? "listo" : "incompleto"}, inglés ${en ? "listo" : "incompleto"}`, `Spanish ${es ? "ready" : "incomplete"}, English ${en ? "ready" : "incomplete"}`)}>
      {([["ES", es], ["EN", en]] as const).map(([code, ready]) => (
        <span
          key={code}
          aria-hidden
          className={cn(
            "rounded px-1 py-px font-mono text-[10px] leading-4 tracking-wider",
            ready ? "bg-muted text-foreground" : "border border-dashed border-amber-500/60 text-amber-600 dark:text-amber-400",
          )}
        >
          {code}
        </span>
      ))}
    </span>
  );
}

function schedule(
  announcement: AdminAnnouncement,
  now: number,
  tr: (es: string, en: string) => string,
  fmt: { date: (iso: string | null) => string; relative: (iso: string | null, now: number) => string },
): string {
  const { startsAt, endsAt, publishedAt, status } = announcement;
  if (status === "draft") return publishedAt ? tr("Despublicado", "Unpublished") : tr("Sin publicar", "Not published");
  if (startsAt && endsAt) return `${fmt.date(startsAt)} → ${fmt.date(endsAt)}`;
  if (startsAt) return `${tr("Desde", "From")} ${fmt.date(startsAt)}`;
  if (endsAt) return `${tr("Hasta", "Until")} ${fmt.date(endsAt)}`;
  return `${tr("Publicado", "Published")} ${fmt.relative(publishedAt, now)}`;
}
