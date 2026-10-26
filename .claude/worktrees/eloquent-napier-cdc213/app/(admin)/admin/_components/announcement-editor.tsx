"use client";

import { ArrowUpRight01Icon, Cancel01Icon, Image01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";

import { AnnouncementCard, KIND_STYLE } from "@/components/announcements/announcement-body";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { DatePicker, type DatePickerLabels } from "@/components/ui/date-picker";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { useToast } from "@/components/toast-provider";
import { ANNOUNCEMENT_LIMITS, isAppPath } from "@/lib/announcement-content";
import {
  type AdminAnnouncement,
  type AdminAnnouncementKind,
  type AdminAnnouncementStatus,
  type AdminDelivery,
  type AdminTenant,
  audienceIncludes,
} from "@/lib/admin-types";
import { cn } from "@/lib/utils";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref, useAdminNow } from "./admin-shell";
import { ANNOUNCEMENT_STATUS_VARIANT, clickRate, liveState } from "./format";

// Writing an announcement (lib/announcements.ts in the tenant, src/announcements.ts
// in the fleet), in Spanish and English. A draft saves however unfinished it
// is; publishing needs both languages complete, which the fleet checks again.
// The preview is the same card customers see, fed the draft as it is typed,
// in the language being edited, so what gets published is what was approved.

type Copy = { title: string; body: string; ctaLabel: string };
type Lang = "es" | "en";
type Tr = (es: string, en: string) => string;

type Draft = {
  kind: AdminAnnouncementKind;
  es: Copy;
  en: Copy;
  ctaUrl: string;
  imageUrl: string;
  access: "" | "beta" | "subscription";
  plans: ("pro" | "managed")[];
  tenants: string[];
  ownersOnly: boolean;
  /** `datetime-local` values, in the operator's own time zone. */
  startsAt: string;
  endsAt: string;
};

const EMPTY_COPY: Copy = { title: "", body: "", ctaLabel: "" };

const KINDS: ReadonlyArray<{ id: AdminAnnouncementKind; es: [string, string]; en: [string, string] }> = [
  { id: "feature", es: ["Novedad", "Algo nuevo en la app"], en: ["New feature", "Something new in the app"] },
  { id: "promo", es: ["Promoción", "Una oferta o descuento"], en: ["Offer", "A deal or a discount"] },
  { id: "notice", es: ["Aviso", "Mantenimiento, cambios"], en: ["Notice", "Maintenance, changes"] },
];

/** The product's own words for the preview (lib/i18n announcement.*), per previewed language. */
const PREVIEW_WORDS: Record<Lang, { kind: Record<AdminAnnouncementKind, string>; later: string; gotIt: string; title: string; body: string }> = {
  es: { kind: { feature: "Novedad", promo: "Promoción", notice: "Aviso" }, later: "Ahora no", gotIt: "Entendido", title: "Título del anuncio", body: "El texto del anuncio aparece aquí." },
  en: { kind: { feature: "New", promo: "Offer", notice: "Notice" }, later: "Not now", gotIt: "Got it", title: "Announcement title", body: "The announcement's text shows up here." },
};

const PUSH_NOTE: Record<keyof AdminDelivery, [string, string]> = {
  applied: ["entregado", "delivered"],
  unsupported: ["con un release que no muestra anuncios", "on a release that does not show announcements"],
  failed: ["falló (el sweep reintenta en 15 minutos)", "failed (the sweep retries in 15 minutes)"],
  skipped: ["sin desplegar todavía", "not deployed yet"],
  none: ["sin FLEET_TOKEN_SECRET en el fleet", "no FLEET_TOKEN_SECRET on the fleet"],
};

/** ISO → `datetime-local` in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function draftOf(announcement: AdminAnnouncement | null): Draft {
  const copy = (value?: { title: string; body: string; ctaLabel?: string }): Copy =>
    value ? { title: value.title, body: value.body, ctaLabel: value.ctaLabel ?? "" } : { ...EMPTY_COPY };
  return {
    kind: announcement?.kind ?? "feature",
    es: copy(announcement?.content.es),
    en: copy(announcement?.content.en),
    ctaUrl: announcement?.ctaUrl ?? "",
    imageUrl: announcement?.imageUrl ?? "",
    access: announcement?.audience.access ?? "",
    plans: [...(announcement?.audience.plans ?? [])],
    tenants: [...(announcement?.audience.tenants ?? [])],
    ownersOnly: announcement?.audience.ownersOnly === true,
    startsAt: toLocalInput(announcement?.startsAt ?? null),
    endsAt: toLocalInput(announcement?.endsAt ?? null),
  };
}

function payloadOf(draft: Draft) {
  const copy = (value: Copy) => ({
    title: value.title.trim(),
    body: value.body.trim(),
    ...(value.ctaLabel.trim() ? { ctaLabel: value.ctaLabel.trim() } : {}),
  });
  const hasEnglish = Boolean(draft.en.title.trim() || draft.en.body.trim() || draft.en.ctaLabel.trim());
  return {
    kind: draft.kind,
    content: { es: copy(draft.es), ...(hasEnglish ? { en: copy(draft.en) } : {}) },
    ctaUrl: draft.ctaUrl.trim() || null,
    imageUrl: draft.imageUrl.trim() || null,
    audience: {
      ...(draft.access ? { access: draft.access } : {}),
      ...(draft.plans.length ? { plans: draft.plans } : {}),
      ...(draft.tenants.length ? { tenants: draft.tenants } : {}),
      ...(draft.ownersOnly ? { ownersOnly: true } : {}),
    },
    startsAt: fromLocalInput(draft.startsAt),
    endsAt: fromLocalInput(draft.endsAt),
  };
}

/** What no save may carry, draft or not: the fleet would refuse it. */
function blockingProblem(draft: Draft, tr: Tr): string | null {
  const url = draft.ctaUrl.trim();
  if (url && !isAppPath(url) && !/^https:\/\/\S+$/i.test(url)) {
    return tr("El enlace tiene que empezar con https:// o con / (una página de la app).", "The link must start with https:// or / (a page in the app).");
  }
  const image = draft.imageUrl.trim();
  if (image && !/^https:\/\/\S+$/i.test(image)) return tr("La imagen tiene que ser una URL https://.", "The image must be an https:// URL.");
  if (draft.startsAt && draft.endsAt && new Date(draft.endsAt) <= new Date(draft.startsAt)) {
    return tr("El final tiene que ser después del inicio.", "The end must come after the start.");
  }
  return null;
}

type Check = { readonly id: string; readonly label: string; readonly done: boolean; readonly lang?: Lang };

/** What publishing needs, as a checklist: both languages complete, a label for a link, a link for a label. */
function publishChecks(draft: Draft, tr: Tr): Check[] {
  const url = draft.ctaUrl.trim();
  const checks: Check[] = [];
  for (const lang of ["es", "en"] as const) {
    const copy = draft[lang];
    const name = lang === "es" ? tr("en español", "in Spanish") : tr("en inglés", "in English");
    checks.push({ id: `${lang}-title`, lang, label: `${tr("Título", "Title")} ${name}`, done: Boolean(copy.title.trim()) });
    checks.push({ id: `${lang}-body`, lang, label: `${tr("Texto", "Text")} ${name}`, done: Boolean(copy.body.trim()) });
    if (url) checks.push({ id: `${lang}-cta`, lang, label: `${tr("Texto del botón", "Button label")} ${name}`, done: Boolean(copy.ctaLabel.trim()) });
  }
  const labelled = Boolean(draft.es.ctaLabel.trim() || draft.en.ctaLabel.trim());
  if (labelled && !url) checks.push({ id: "cta-url", label: tr("Enlace para el botón", "A link for the button"), done: false });
  return checks;
}

function languageState(draft: Draft, lang: Lang): "done" | "partial" | "empty" {
  const copy = draft[lang];
  const needsLabel = Boolean(draft.ctaUrl.trim());
  const filled = [copy.title, copy.body, ...(needsLabel ? [copy.ctaLabel] : [])].filter((value) => value.trim()).length;
  const total = needsLabel ? 3 : 2;
  if (filled === total) return "done";
  return copy.title.trim() || copy.body.trim() || copy.ctaLabel.trim() ? "partial" : "empty";
}

type ApiAnswer = { announcement?: AdminAnnouncement | null; delivery?: AdminDelivery | null; message?: string; error?: string };

export function AnnouncementEditor({
  announcement,
  tenants,
}: {
  readonly announcement: AdminAnnouncement | null;
  readonly tenants: readonly AdminTenant[];
}) {
  const router = useRouter();
  const href = useAdminHref();
  const now = useAdminNow();
  const { locale, tr, fmt, labels } = useAdminLocale();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const [draft, setDraft] = useState<Draft>(() => draftOf(announcement));
  const [saved, setSaved] = useState<Draft>(() => draftOf(announcement));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(locale);
  const [flash, setFlash] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // A save's confirmation stays in the action bar for a few seconds, where the eye already is.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(timer);
  }, [flash]);

  const status: AdminAnnouncementStatus = announcement?.status ?? "draft";
  const pickerLabels: DatePickerLabels = {
    placeholder: tr("Sin fecha", "No date"),
    previousMonth: tr("Mes anterior", "Previous month"),
    nextMonth: tr("Mes siguiente", "Next month"),
    clear: tr("Quitar", "Clear"),
    today: tr("Hoy", "Today"),
    time: tr("Hora", "Time"),
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const blocking = blockingProblem(draft, tr);
  const checks = publishChecks(draft, tr);
  const missing = checks.filter((check) => !check.done);
  const publishable = !blocking && missing.length === 0;
  const live = tenants.filter((tenant) => tenant.status !== "deleted");
  const audience = payloadOf(draft).audience;
  const reach = live.filter((tenant) => audienceIncludes(audience, tenant)).length;
  const state = announcement ? liveState(announcement, now) : null;
  const neverPublished = !announcement?.publishedAt;
  const canSaveDraft = status !== "published" && !busy && !blocking && dirty;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setCopy = (which: Lang, key: keyof Copy, value: string) =>
    setDraft((current) => ({ ...current, [which]: { ...current[which], [key]: value } }));

  // Leaving with unsaved work asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const call = async (body: Record<string, unknown>): Promise<ApiAnswer | null> => {
    const response = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const answer = (await response?.json().catch(() => null)) as ApiAnswer | null;
    if (!response?.ok) {
      setError(answer?.message ?? answer?.error ?? tr("El fleet no respondió.", "The fleet did not answer."));
      return null;
    }
    return answer ?? {};
  };

  /** What the push reached, in one line; null when nothing was pushed. */
  const deliveryNote = (delivery: AdminDelivery | null | undefined): { text: string; partial: boolean } | null => {
    if (!delivery) return null;
    const notes = (Object.keys(PUSH_NOTE) as (keyof AdminDelivery)[])
      .filter((key) => key !== "applied" && delivery[key] > 0)
      .map((key) => `${delivery[key]} ${tr(...PUSH_NOTE[key])}`);
    const reached = fmt.count(delivery.applied, ["cliente", "clientes"], ["customer", "customers"]);
    return { text: [tr(`Entregado a ${reached}.`, `Delivered to ${reached}.`), ...notes].join(" "), partial: notes.length > 0 };
  };

  /** Leaving the page: a toast, since the list has no action bar. Staying: the bar says it. */
  const announce = (title: string, delivery: AdminDelivery | null | undefined, leaving: boolean) => {
    const note = deliveryNote(delivery);
    if (leaving) toast({ title, description: note?.text, status: note?.partial ? "warning" : "success" });
    else setFlash(note ? `${title} · ${note.text}` : title);
  };

  /** Saves the draft; returns the announcement's id, or null when it failed. */
  const save = async (): Promise<{ id: string; delivery: AdminDelivery | null | undefined } | null> => {
    const answer = await call({ action: "save", ...(announcement ? { id: announcement.id } : {}), announcement: payloadOf(draft) });
    if (!answer?.announcement) return null;
    setSaved(draft);
    return { id: answer.announcement.id, delivery: answer.delivery };
  };

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    run("save", async () => {
      const result = await save();
      if (!result) return;
      announce(status === "published" ? tr("Cambios publicados", "Changes published") : tr("Borrador guardado", "Draft saved"), result.delivery, false);
      if (!announcement) router.replace(href(`/announcements/${result.id}`));
      else router.refresh();
    });

  const onStatus = (next: AdminAnnouncementStatus | "delete", label: string) =>
    run(next, async () => {
      let id = announcement?.id;
      if (next !== "delete" && (dirty || !id)) {
        const result = await save();
        if (!result) return;
        id = result.id;
      }
      const answer = await call({ action: "status", id, status: next });
      if (!answer) return;
      const leaving = next === "delete" || next === "published" || !announcement;
      announce(label, answer.delivery, leaving);
      if (next === "delete" || next === "published") router.push(href("/announcements"));
      else if (!announcement && id) router.replace(href(`/announcements/${id}`));
      router.refresh();
    });

  const askThen = async (options: { title: string; description: string; confirmLabel: string }, then: () => void) => {
    if (await confirm({ ...options, cancelLabel: tr("Cancelar", "Cancel") })) then();
  };

  // ⌘S / Ctrl+S keeps a draft: the reflex works, a published one never goes out by accident.
  const saveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveRef.current = () => {
      if (canSaveDraft) void onSave();
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = (locale === "en" ? announcement?.content.en?.title : announcement?.content.es.title)?.trim()
    || announcement?.content.es.title.trim()
    || announcement?.content.en?.title.trim()
    || (announcement ? tr("Sin título", "Untitled") : tr("Nuevo anuncio", "New announcement"));

  const savedAt = announcement ? Date.parse(announcement.updatedAt) : 0;
  const statusLine = error ?? blocking
    ?? (busy ? tr("Guardando…", "Saving…")
      : flash && !dirty ? flash
      : dirty ? tr("Cambios sin guardar · ⌘S guarda el borrador", "Unsaved changes · ⌘S saves the draft")
      : status === "published" ? tr("Publicado · al día", "Published · up to date")
      : announcement ? `${tr("Guardado", "Saved")} ${fmt.relative(announcement.updatedAt, Math.max(now, savedAt))}`
      : tr("Empieza a escribir: el borrador se guarda aunque esté incompleto.", "Start writing: a draft saves even when unfinished."));
  const statusTone = error || blocking ? "error" : dirty && !busy ? "warning" : "ok";

  return (
    <div className="content-enter space-y-6 pb-4">
      {dialog}
      <PageHeader
        back={{ href: href("/announcements"), label: tr("Anuncios", "Announcements") }}
        title={title}
        badges={
          <>
            <StatusBadge status={ANNOUNCEMENT_STATUS_VARIANT[status]} label={labels.announcementStatus[status]} />
            {state === "scheduled" ? <StatusBadge status="pending" label={labels.live.scheduled} /> : null}
            {state === "ended" ? <StatusBadge status="expired" label={labels.live.ended} /> : null}
          </>
        }
        description={
          announcement
            ? [
                announcement.createdBy ? tr(`Escrito por ${announcement.createdBy}`, `Written by ${announcement.createdBy}`) : null,
                `${tr("editado", "edited")} ${fmt.dateTime(announcement.updatedAt)}`,
                announcement.publishedAt ? `${tr("publicado", "published")} ${fmt.dateTime(announcement.publishedAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : tr(
                "Una novedad, una promoción o un aviso para tus clientes, en español y en inglés.",
                "A new feature, an offer or a notice for your customers, in Spanish and English.",
              )
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <div className="space-y-4">
          <Section title={tr("Tipo", "Kind")} description={tr("Cambia la etiqueta, el color y la ilustración", "Sets the label, the colours and the artwork")}>
            <KindPicker value={draft.kind} onChange={(kind) => set("kind", kind)} />
          </Section>

          <Card>
            <CardHeader>
              <div className="min-w-0 flex-1">
                <CardTitle>{tr("Contenido", "Content")}</CardTitle>
                <CardDescription>{tr("Cada cliente lo ve en el idioma en que usa la app. Ambos son obligatorios para publicar.", "Each customer sees it in the language they use the app in. Both are required to publish.")}</CardDescription>
              </div>
            </CardHeader>
            <CardSeparator />
            <CardBody className="space-y-4">
              <LanguageTabs value={lang} onChange={setLang} states={{ es: languageState(draft, "es"), en: languageState(draft, "en") }} />
              <div key={lang} className="admin-swap space-y-4">
                <CopyFields lang={lang} copy={draft[lang]} onChange={setCopy} needsLabel={Boolean(draft.ctaUrl.trim())} />
              </div>
            </CardBody>
          </Card>

          <Section title={tr("Botón e imagen", "Button and image")} description={tr("Ambos opcionales", "Both optional")}>
            <Field
              label={tr("Enlace del botón", "Button link")}
              hint={tr(
                "Una página de la app (/agents, /settings/billing) o una URL https:// (se abre en otra pestaña). El texto del botón va en cada idioma.",
                "A page in the app (/agents, /settings/billing) or an https:// URL (opens in a new tab). The button's label goes in each language.",
              )}
            >
              {(id) => (
                <Input
                  id={id}
                  value={draft.ctaUrl}
                  onChange={(e) => set("ctaUrl", e.target.value)}
                  placeholder="/agents"
                  spellCheck={false}
                  aria-invalid={blocking && draft.ctaUrl.trim() && !isAppPath(draft.ctaUrl.trim()) && !/^https:\/\/\S+$/i.test(draft.ctaUrl.trim()) ? true : undefined}
                />
              )}
            </Field>
            <Field label={tr("Imagen", "Image")} hint={tr("URL https:// de una imagen horizontal (2:1). Reemplaza la ilustración del tipo.", "An https:// URL of a landscape image (2:1). Replaces the kind's artwork.")}>
              {(id) => (
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
                    {/^https:\/\/\S+$/i.test(draft.imageUrl.trim()) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the operator's own https image, previewed as typed.
                      <img src={draft.imageUrl.trim()} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
                    ) : (
                      <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={1.75} />
                    )}
                  </span>
                  <Input id={id} value={draft.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" spellCheck={false} />
                  {draft.imageUrl ? (
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={tr("Quitar imagen", "Remove image")} onClick={() => set("imageUrl", "")}>
                      <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>
          </Section>

          <Section
            title={tr("Quién lo ve", "Who sees it")}
            description={tr(`Llega a ${fmt.number(reach)} de ${fmt.number(live.length)} clientes`, `Reaches ${fmt.number(reach)} of ${fmt.number(live.length)} customers`)}
          >
            <ChipGroup label={tr("Acceso", "Access")}>
              {(
                [
                  ["", tr("Todos", "Everyone")],
                  ["beta", "Beta"],
                  ["subscription", tr("Pagando", "Paying")],
                ] as const
              ).map(([value, label]) => (
                <ToggleChip key={value || "all"} selected={draft.access === value} onClick={() => set("access", value)}>
                  {label}
                </ToggleChip>
              ))}
            </ChipGroup>
            <ChipGroup label="Plan" note={draft.plans.length ? undefined : tr("ninguno marcado = todos", "none picked = all")}>
              {(["pro", "managed"] as const).map((plan) => (
                <ToggleChip
                  key={plan}
                  selected={draft.plans.includes(plan)}
                  onClick={() => set("plans", draft.plans.includes(plan) ? draft.plans.filter((p) => p !== plan) : [...draft.plans, plan])}
                >
                  {labels.plan[plan]}
                </ToggleChip>
              ))}
            </ChipGroup>
            <div className="space-y-1.5">
              <ChipGroup label={tr("Clientes específicos", "Specific customers")}>
                {live.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tr("No hay clientes en el registro.", "No customers in the registry.")}</p>
                ) : (
                  live.map((tenant) => (
                    <ToggleChip
                      key={tenant.id}
                      selected={draft.tenants.includes(tenant.id)}
                      onClick={() =>
                        set("tenants", draft.tenants.includes(tenant.id) ? draft.tenants.filter((id) => id !== tenant.id) : [...draft.tenants, tenant.id])
                      }
                    >
                      {tenant.slug}
                    </ToggleChip>
                  ))
                )}
              </ChipGroup>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "Sin marcar ninguno, todos. Cada cliente recibe solo lo suyo: nadie ve a quién más se le mandó.",
                  "None picked means all. Each customer receives only its own: nobody sees who else got it.",
                )}
              </p>
            </div>
            <label className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <span>
                <span className="block text-sm">{tr("Solo el dueño de cada instalación", "Only each install's owner")}</span>
                <span className="block text-xs text-muted-foreground">{tr("Para promociones del plan o avisos de facturación.", "For plan offers or billing notices.")}</span>
              </span>
              <Switch checked={draft.ownersOnly} onCheckedChange={(value) => set("ownersOnly", value)} label={tr("Solo el dueño", "Owner only")} />
            </label>
          </Section>

          <Section title={tr("Cuándo", "When")} description={tr("Vacío: desde que se publica y sin final. Hora de tu navegador.", "Empty: from publishing, with no end. Your browser's time.")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr("Desde", "From")}>
                {(id) => (
                  <DatePicker
                    id={id}
                    withTime
                    locale={locale}
                    labels={pickerLabels}
                    value={draft.startsAt}
                    max={draft.endsAt ? draft.endsAt.slice(0, 10) : undefined}
                    onChange={(value) => set("startsAt", value)}
                  />
                )}
              </Field>
              <Field label={tr("Hasta", "Until")}>
                {(id) => (
                  <DatePicker
                    id={id}
                    withTime
                    defaultTime="23:30"
                    locale={locale}
                    labels={pickerLabels}
                    value={draft.endsAt}
                    min={draft.startsAt ? draft.startsAt.slice(0, 10) : undefined}
                    onChange={(value) => set("endsAt", value)}
                  />
                )}
              </Field>
            </div>
          </Section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20">
          <Card>
            <CardHeader>
              <div className="min-w-0 flex-1">
                <CardTitle>{tr("Vista previa", "Preview")}</CardTitle>
                <CardDescription>{tr("El mismo diálogo que ve el cliente", "The same dialog the customer sees")}</CardDescription>
              </div>
              <LanguageTabs compact value={lang} onChange={setLang} states={{ es: languageState(draft, "es"), en: languageState(draft, "en") }} />
            </CardHeader>
            <CardSeparator />
            <div className="bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-[length:14px_14px] p-4">
              <Preview draft={draft} lang={lang} />
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div className="min-w-0 flex-1">
                <CardTitle>{status === "published" ? tr("Sigue publicable", "Still publishable") : tr("Para publicar", "To publish")}</CardTitle>
                <CardDescription>
                  {publishable
                    ? tr("Todo listo: ambos idiomas completos.", "All set: both languages complete.")
                    : tr(`Faltan ${missing.length} de ${checks.length}`, `${missing.length} of ${checks.length} to go`)}
                </CardDescription>
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {checks.length - missing.length}/{checks.length}
              </span>
            </CardHeader>
            <CardSeparator />
            <CardBody>
              <ul className="space-y-1.5">
                {checks.map((check) => (
                  <li key={check.id}>
                    <button
                      type="button"
                      disabled={!check.lang}
                      onClick={() => check.lang && setLang(check.lang)}
                      className="flex w-full items-center gap-2.5 rounded-md text-left text-sm transition-colors enabled:hover:text-foreground disabled:cursor-default"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full transition-[background-color,box-shadow] duration-200",
                          check.done ? "bg-emerald-500 text-white" : "shadow-[inset_0_0_0_1.5px_var(--border)]",
                        )}
                      >
                        {check.done ? (
                          <HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={2.2} className="admin-check size-2.5" />
                        ) : null}
                      </span>
                      <span className={check.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}>{check.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {announcement && !neverPublished ? (
            <Card>
              <CardHeader>
                <div className="min-w-0 flex-1">
                  <CardTitle>{tr("Resultados", "Results")}</CardTitle>
                  <CardDescription>
                    {tr(
                      `Sumados del último tick de ${fmt.count(announcement.stats.tenantsReporting, ["cliente", "clientes"], ["customer", "customers"])}`,
                      `Summed from the last tick of ${fmt.count(announcement.stats.tenantsReporting, ["cliente", "clientes"], ["customer", "customers"])}`,
                    )}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardSeparator />
              <CardBody>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label={tr("Lo vieron", "Saw it")} value={fmt.number(announcement.stats.seen)} />
                  <Metric label={tr("Abrieron el botón", "Followed the button")} value={`${fmt.number(announcement.stats.clicked)} · ${clickRate(announcement.stats)}`} />
                  <Metric label={tr("Lo cerraron", "Closed it")} value={fmt.number(announcement.stats.dismissed)} />
                  <Metric label={tr("Clientes alcanzados", "Customers reached")} value={fmt.number(announcement.reach)} />
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog open={publishing} onOpenChange={(open) => (open ? undefined : setPublishing(false))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("¿Publicar ahora?", "Publish now?")}</DialogTitle>
            <DialogDescription>
              {tr("Se entrega con la configuración de cada cliente, en segundos y sin deploy.", "It rides each customer's configuration, in seconds and with no deploy.")}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border border-border bg-muted/30 p-3.5 text-sm">
            <dt className="text-muted-foreground">{tr("Llega a", "Reaches")}</dt>
            <dd className="text-right">{fmt.count(reach, ["cliente", "clientes"], ["customer", "customers"])}</dd>
            <dt className="text-muted-foreground">{tr("Idiomas", "Languages")}</dt>
            <dd className="text-right">Español · English</dd>
            <dt className="text-muted-foreground">{tr("Desde", "From")}</dt>
            <dd className="text-right">{draft.startsAt ? fmt.dateTime(fromLocalInput(draft.startsAt)) : tr("Ahora", "Now")}</dd>
            {draft.endsAt ? (
              <>
                <dt className="text-muted-foreground">{tr("Hasta", "Until")}</dt>
                <dd className="text-right">{fmt.dateTime(fromLocalInput(draft.endsAt))}</dd>
              </>
            ) : null}
          </dl>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPublishing(false)}>
              {tr("Cancelar", "Cancel")}
            </Button>
            <Button
              disabled={!!busy}
              onClick={() => {
                setPublishing(false);
                void onStatus("published", tr("Publicado", "Published"));
              }}
            >
              {tr("Publicar", "Publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="sticky bottom-4 z-20">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/80 bg-card/90 p-2.5 pl-4 shadow-[var(--shadow-float)] backdrop-blur-md">
          <p aria-live="polite" className="flex min-w-0 basis-full items-center gap-2 text-sm sm:basis-0 sm:flex-1">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full transition-colors duration-200",
                statusTone === "error" ? "bg-destructive" : statusTone === "warning" ? "bg-amber-500" : "bg-emerald-500",
              )}
            />
            <span
              key={statusLine}
              className={cn("admin-swap min-w-0 truncate sm:whitespace-normal", statusTone === "error" ? "text-destructive" : "text-muted-foreground")}
              title={statusLine}
            >
              {statusLine}
            </span>
          </p>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {announcement && status !== "archived" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!!busy}
                onClick={() =>
                  void askThen(
                    {
                      title: tr("¿Archivar este anuncio?", "Archive this announcement?"),
                      description:
                        status === "published"
                          ? tr("Deja de mostrarse a los clientes al instante. Sus números se conservan.", "It stops showing to customers at once. Its numbers stay.")
                          : tr("Sale de los borradores. Puedes volver a publicarlo después.", "It leaves the drafts. You can publish it again later."),
                      confirmLabel: tr("Archivar", "Archive"),
                    },
                    () => void onStatus("archived", tr("Archivado", "Archived")),
                  )
                }
              >
                {busy === "archived" ? tr("Archivando…", "Archiving…") : tr("Archivar", "Archive")}
              </Button>
            ) : null}
            {announcement && status === "draft" && neverPublished ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={!!busy}
                onClick={() =>
                  void askThen(
                    {
                      title: tr("¿Eliminar este borrador?", "Delete this draft?"),
                      description: tr("Nunca se publicó, así que desaparece del todo. No se puede deshacer.", "It was never published, so it goes for good. This cannot be undone."),
                      confirmLabel: tr("Eliminar", "Delete"),
                    },
                    () => void onStatus("delete", tr("Borrador eliminado", "Draft deleted")),
                  )
                }
              >
                {busy === "delete" ? tr("Eliminando…", "Deleting…") : tr("Eliminar", "Delete")}
              </Button>
            ) : null}
            {status === "published" ? (
              <>
                <Button
                  variant="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void askThen(
                      {
                        title: tr("¿Despublicar?", "Unpublish?"),
                        description: tr("Deja de mostrarse a los clientes y vuelve a borrador.", "It stops showing to customers and goes back to draft."),
                        confirmLabel: tr("Despublicar", "Unpublish"),
                      },
                      () => void onStatus("draft", tr("Despublicado", "Unpublished")),
                    )
                  }
                >
                  {busy === "draft" ? tr("Despublicando…", "Unpublishing…") : tr("Despublicar", "Unpublish")}
                </Button>
                <Button disabled={!!busy || !publishable || !dirty} onClick={() => void onSave()}>
                  {busy === "save" ? tr("Publicando cambios…", "Publishing changes…") : tr("Publicar cambios", "Publish changes")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" disabled={!canSaveDraft} onClick={() => void onSave()} title="⌘S">
                  {busy === "save" ? tr("Guardando…", "Saving…") : tr("Guardar borrador", "Save draft")}
                </Button>
                <Button disabled={!!busy || !publishable} onClick={() => setPublishing(true)}>
                  {busy === "published" ? tr("Publicando…", "Publishing…") : status === "archived" ? tr("Volver a publicar", "Publish again") : tr("Publicar", "Publish")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The three kinds on one recessed track, like the product's sliding tabs:
 * a raised card glides to the chosen one, and the others rest quieter,
 * their swatch dimmed, so the choice reads without borders or markers.
 */
function KindPicker({ value, onChange }: { readonly value: AdminAnnouncementKind; readonly onChange: (kind: AdminAnnouncementKind) => void }) {
  const { locale, tr } = useAdminLocale();
  const card = useRef<HTMLSpanElement>(null);
  const options = useRef(new Map<AdminAnnouncementKind, HTMLButtonElement>());
  const placed = useRef(false);

  useEffect(() => {
    const place = (animate: boolean) => {
      const node = card.current;
      const option = options.current.get(value);
      if (!node || !option) return;
      if (!animate) node.style.transition = "none";
      node.style.width = `${option.offsetWidth}px`;
      node.style.height = `${option.offsetHeight}px`;
      node.style.transform = `translate(${option.offsetLeft}px, ${option.offsetTop}px)`;
      node.style.opacity = "1";
      if (!animate) {
        void node.offsetWidth;
        node.style.transition = "";
      }
    };
    place(placed.current);
    placed.current = true;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place(false));
    for (const option of options.current.values()) observer?.observe(option);
    return () => observer?.disconnect();
  }, [value]);

  return (
    <div
      role="radiogroup"
      aria-label={tr("Tipo de anuncio", "Announcement kind")}
      className="relative grid gap-1 rounded-2xl bg-muted p-1 shadow-[var(--shadow-inset)] sm:grid-cols-3"
    >
      <span
        ref={card}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-xl bg-[var(--tabs-pill-bg)] opacity-0 shadow-[var(--tabs-pill-shadow)] transition-[transform,width,height] duration-300 ease-expo-out motion-reduce:transition-none"
      />
      {KINDS.map((kind) => {
        const selected = value === kind.id;
        const [name, hint] = locale === "en" ? kind.en : kind.es;
        return (
          <button
            key={kind.id}
            ref={(node) => {
              if (node) options.current.set(kind.id, node);
              else options.current.delete(kind.id);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(kind.id)}
            className="group relative z-10 flex items-center gap-3 rounded-xl p-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span
              className={cn(
                "transition-[opacity,filter,transform] duration-300 ease-expo-out",
                selected ? "opacity-100 saturate-100" : "opacity-55 saturate-50 group-hover:opacity-80 group-hover:saturate-75",
              )}
            >
              <KindSwatch kind={kind.id} />
            </span>
            <span className="min-w-0">
              <span className={cn("block text-sm font-medium transition-colors duration-200", selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                {name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A small tile in the kind's colours, the same family as the hero. */
function KindSwatch({ kind }: { readonly kind: AdminAnnouncementKind }) {
  const hue = KIND_STYLE[kind].hue;
  return (
    <span
      aria-hidden
      className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.35),0_4px_10px_-4px_oklch(0_0_0/0.35)]"
      style={
        {
          background: `radial-gradient(60% 70% at 25% 20%, oklch(0.8 0.14 ${hue + 35}), transparent 70%), radial-gradient(70% 80% at 85% 90%, oklch(0.55 0.2 ${hue - 25}), transparent 70%), oklch(0.6 0.18 ${hue})`,
        } as CSSProperties
      }
    >
      <HugeiconsIcon icon={KIND_STYLE[kind].icon} size={18} strokeWidth={1.75} />
    </span>
  );
}

/** ES / EN on the product's sliding tabs; each side shows whether its copy is complete. */
function LanguageTabs({
  value,
  onChange,
  states,
  compact = false,
}: {
  readonly value: Lang;
  readonly onChange: (lang: Lang) => void;
  readonly states: Record<Lang, "done" | "partial" | "empty">;
  readonly compact?: boolean;
}) {
  const { tr } = useAdminLocale();
  const stateLabel = (state: "done" | "partial" | "empty") =>
    state === "done" ? tr("completo", "complete") : state === "partial" ? tr("incompleto", "incomplete") : tr("vacío", "empty");
  const label = (lang: Lang) => (
    <span className="flex items-center gap-1.5" aria-label={`${lang === "es" ? "Español" : "English"} · ${stateLabel(states[lang])}`}>
      <span aria-hidden className={compact ? "font-mono text-[11px] uppercase tracking-wider" : undefined}>
        {compact ? lang : lang === "es" ? "Español" : "English"}
      </span>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full transition-[background-color,transform] duration-300 ease-expo-out",
          states[lang] === "done" ? "scale-100 bg-emerald-500" : states[lang] === "partial" ? "scale-100 bg-amber-500" : "scale-75 bg-muted-foreground/30",
        )}
      />
    </span>
  );
  return (
    <SlidingTabs
      className={compact ? "shrink-0" : undefined}
      tabs={[
        { id: "es", label: label("es") },
        { id: "en", label: label("en") },
      ]}
      value={value}
      onValueChange={(id) => onChange(id as Lang)}
    />
  );
}

function CopyFields({
  lang,
  copy,
  onChange,
  needsLabel,
}: {
  readonly lang: Lang;
  readonly copy: Copy;
  readonly onChange: (lang: Lang, key: keyof Copy, value: string) => void;
  readonly needsLabel: boolean;
}) {
  const { tr } = useAdminLocale();
  const english = lang === "en";
  const suffix = english ? tr(" (inglés)", " (English)") : tr(" (español)", " (Spanish)");
  return (
    <>
      <Field label={`${tr("Título", "Title")}${suffix}`} count={[copy.title.length, ANNOUNCEMENT_LIMITS.title]}>
        {(id) => (
          <Input
            id={id}
            lang={lang}
            value={copy.title}
            maxLength={ANNOUNCEMENT_LIMITS.title}
            onChange={(e) => onChange(lang, "title", e.target.value)}
            placeholder={english ? "New: your agent now answers calls" : "Nuevo: tu agente ya atiende llamadas"}
          />
        )}
      </Field>
      <Field
        label={`${tr("Texto", "Text")}${suffix}`}
        count={[copy.body.length, ANNOUNCEMENT_LIMITS.body]}
        hint={tr("Una línea en blanco empieza otro párrafo; «- » al inicio de cada línea arma una lista.", "A blank line starts a new paragraph; “- ” at the start of each line makes a list.")}
      >
        {(id) => (
          <Textarea
            id={id}
            lang={lang}
            value={copy.body}
            maxLength={ANNOUNCEMENT_LIMITS.body}
            onChange={(e) => onChange(lang, "body", e.target.value)}
            placeholder={english ? "Your agent can now pick up WhatsApp calls by voice." : "Ahora tu agente puede contestar llamadas de WhatsApp con voz."}
            className="min-h-32"
          />
        )}
      </Field>
      <Field
        label={`${tr("Texto del botón", "Button label")}${suffix}`}
        count={[copy.ctaLabel.length, ANNOUNCEMENT_LIMITS.ctaLabel]}
        hint={needsLabel ? undefined : tr("Solo se muestra si pones un enlace abajo.", "Only shows when you add a link below.")}
      >
        {(id) => (
          <Input
            id={id}
            lang={lang}
            value={copy.ctaLabel}
            maxLength={ANNOUNCEMENT_LIMITS.ctaLabel}
            onChange={(e) => onChange(lang, "ctaLabel", e.target.value)}
            placeholder={english ? "Try it" : "Probarlo"}
          />
        )}
      </Field>
    </>
  );
}

function Preview({ draft, lang }: { readonly draft: Draft; readonly lang: Lang }) {
  const words = PREVIEW_WORDS[lang];
  const copy = draft[lang];
  const imageUrl = /^https:\/\/\S+$/i.test(draft.imageUrl.trim()) ? draft.imageUrl.trim() : null;
  const url = draft.ctaUrl.trim();
  const hasCta = Boolean(url && copy.ctaLabel.trim());
  const external = hasCta && !isAppPath(url);
  return (
    <div className="pointer-events-none mx-auto max-w-[380px] select-none rounded-[20px] border border-border/70 bg-muted/60 p-1.5 shadow-[var(--shadow-float)]" aria-hidden>
      <div key={lang} className="admin-swap">
        <AnnouncementCard
          kind={draft.kind}
          kindLabel={words.kind[draft.kind]}
          copy={{ title: copy.title, body: copy.body.trim() || words.body }}
          imageUrl={imageUrl}
          title={
            <p className={cn("text-lg font-medium leading-snug tracking-[-0.015em] text-balance", !copy.title.trim() && "text-muted-foreground/60")}>
              {copy.title.trim() || words.title}
            </p>
          }
          overlay={
            <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-black/25 text-white backdrop-blur-md">
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </span>
          }
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-2 pb-1 pt-2.5">
        {hasCta ? (
          <>
            <Button size="sm" variant="outline" tabIndex={-1}>
              {words.later}
            </Button>
            <Button size="sm" tabIndex={-1}>
              {copy.ctaLabel}
              {external ? <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={2} /> : null}
            </Button>
          </>
        ) : (
          <Button size="sm" tabIndex={-1}>
            {words.gotIt}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ title, description, children }: { readonly title: string; readonly description: string; readonly children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

function ChipGroup({ label, note, children }: { readonly label: string; readonly note?: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
        {children}
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  count,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly count?: readonly [number, number];
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        {count ? (
          <span className={cn("text-xs tabular-nums text-muted-foreground", count[0] > count[1] * 0.9 && "text-amber-600 dark:text-amber-400")}>
            {count[0]}/{count[1]}
          </span>
        ) : null}
      </div>
      {children(id)}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
