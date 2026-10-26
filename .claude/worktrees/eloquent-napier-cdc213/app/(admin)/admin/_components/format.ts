import type { StatusVariant } from "@/components/ui/status-badge";
import type { AccessRequestSource, AccessRequestStatus } from "@/lib/access-request-types";
import type { CallFilter } from "@/lib/admin-calls-types";
import type { AdminLocale } from "@/lib/admin-locale";
import { TICK_STALE_MS, type AdminAnnouncement, type AdminAnnouncementAudience, type AdminRelease, type AdminTenant } from "@/lib/admin-types";
import type { Revenue } from "@/lib/admin-overview";

// Labels and number formats for the operator's panel, in its two languages
// (lib/admin-locale.ts). Every date is Bogotá time, whatever the server's or
// the browser's zone, so both hydration renders agree.

const NUMBER_LOCALE: Record<AdminLocale, string> = { es: "es-AR", en: "en-US" };
const DATE_FORMAT: Record<AdminLocale, Intl.DateTimeFormat> = {
  es: new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }),
  en: new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }),
};

function dateParts(iso: string, locale: AdminLocale): Record<string, string> | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return Object.fromEntries(DATE_FORMAT[locale].formatToParts(date).map(({ type, value }) => [type, value]));
}

export function formatDateTime(iso: string | null | undefined, locale: AdminLocale = "es"): string {
  if (!iso) return "—";
  const parts = dateParts(iso, locale);
  if (!parts) return "—";
  return locale === "en"
    ? `${parts.month} ${parts.day}, ${parts.year} · ${parts.hour}:${parts.minute}`
    : `${parts.day}/${parts.month}/${parts.year} · ${parts.hour}:${parts.minute}`;
}

export function formatDate(iso: string | null | undefined, locale: AdminLocale = "es"): string {
  if (!iso) return "—";
  const parts = dateParts(iso, locale);
  if (!parts) return "—";
  return locale === "en" ? `${parts.month} ${parts.day}, ${parts.year}` : `${parts.day}/${parts.month}/${parts.year}`;
}

const RELATIVE: Record<AdminLocale, Intl.RelativeTimeFormat> = {
  es: new Intl.RelativeTimeFormat(NUMBER_LOCALE.es, { numeric: "auto" }),
  en: new Intl.RelativeTimeFormat(NUMBER_LOCALE.en, { numeric: "auto" }),
};

/** "hace 5 minutos", "2 days ago": coarse on purpose, the exact time is in the title. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now(), locale: AdminLocale = "es"): string {
  if (!iso) return locale === "en" ? "never" : "nunca";
  const format = RELATIVE[locale];
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}

export function formatNumber(value: number, locale: AdminLocale = "es"): string {
  return Math.round(value).toLocaleString(NUMBER_LOCALE[locale]);
}

/** USD with cents below ten dollars, whole dollars above. */
export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value !== 0 && Math.abs(value) < 10 ? 2 : 0,
  });
}

/** An amount in any currency Stripe bills, e.g. "US$79" or "€12,50"; whole units above 10. */
export function formatMoney(value: number, currency: string, locale: AdminLocale = "es"): string {
  try {
    return value.toLocaleString(NUMBER_LOCALE[locale], {
      style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: value !== 0 && Math.abs(value) < 10 ? 2 : 0,
    });
  } catch {
    return `${formatNumber(value, locale)} ${currency.toUpperCase()}`;
  }
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "—";
}

// ── Labels ──────────────────────────────────────────────────────────

type Labels = {
  plan: Record<string, string>;
  status: Record<AdminTenant["status"], string>;
  channelState: Record<string, string>;
  kind: Record<AdminAnnouncement["kind"], string>;
  announcementStatus: Record<AdminAnnouncement["status"], string>;
  live: Record<"live" | "scheduled" | "ended", string>;
  release: Record<AdminRelease["status"], string>;
  requestSource: Record<AccessRequestSource, string>;
  requestStatus: Record<AccessRequestStatus, string>;
  callFilter: Record<CallFilter, string>;
  access: Record<"beta" | "subscription" | "test", string>;
};

const LABELS: Record<AdminLocale, Labels> = {
  es: {
    plan: { pro: "Pro", managed: "Managed", none: "Sin plan" },
    status: {
      requested: "Pedido", provisioning: "Creando", failed: "Falló", awaiting_owner: "Esperando dueño",
      active: "Activo", suspended: "Suspendido", deleted: "Borrado",
    },
    channelState: { connected: "Conectado", registering: "Registrando", connecting: "Conectando", failed: "Falló", disconnected: "Sin conectar" },
    kind: { feature: "Novedad", promo: "Promoción", notice: "Aviso" },
    announcementStatus: { draft: "Borrador", published: "Publicado", archived: "Archivado" },
    live: { live: "En vivo", scheduled: "Programado", ended: "Terminó" },
    release: { testing: "Probando", gate_failed: "Falló en prueba", rolling_out: "Publicando", complete: "Completo", halted: "Detenido" },
    requestSource: { "early-access": "Beta privada", pricing: "Enterprise", clients: "Consulta comercial" },
    requestStatus: { pending: "Pendiente", contacted: "Contactada", admitted: "Admitida", closed: "Cerrada" },
    callFilter: { upcoming: "Próximas", unconfirmed: "Por confirmar", past: "Anteriores", cancelled: "Canceladas", recurring: "Recurrentes", all: "Todas" },
    access: { beta: "Beta", subscription: "Suscripción", test: "Prueba" },
  },
  en: {
    plan: { pro: "Pro", managed: "Managed", none: "No plan" },
    status: {
      requested: "Requested", provisioning: "Creating", failed: "Failed", awaiting_owner: "Awaiting owner",
      active: "Active", suspended: "Suspended", deleted: "Deleted",
    },
    channelState: { connected: "Connected", registering: "Registering", connecting: "Connecting", failed: "Failed", disconnected: "Not connected" },
    kind: { feature: "New", promo: "Offer", notice: "Notice" },
    announcementStatus: { draft: "Draft", published: "Published", archived: "Archived" },
    live: { live: "Live", scheduled: "Scheduled", ended: "Ended" },
    release: { testing: "Testing", gate_failed: "Failed in test", rolling_out: "Rolling out", complete: "Complete", halted: "Halted" },
    requestSource: { "early-access": "Private beta", pricing: "Enterprise", clients: "Sales inquiry" },
    requestStatus: { pending: "Pending", contacted: "Contacted", admitted: "Admitted", closed: "Closed" },
    callFilter: { upcoming: "Upcoming", unconfirmed: "Unconfirmed", past: "Past", cancelled: "Cancelled", recurring: "Recurring", all: "All" },
    access: { beta: "Beta", subscription: "Subscription", test: "Test" },
  },
};

export function adminLabels(locale: AdminLocale): Labels {
  return LABELS[locale];
}

export const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };

export const STATUS_VARIANT: Record<AdminTenant["status"], StatusVariant> = {
  requested: "pending",
  provisioning: "in-progress",
  failed: "failed",
  awaiting_owner: "pending",
  active: "active",
  suspended: "paused",
  deleted: "expired",
};

export const ANNOUNCEMENT_STATUS_VARIANT: Record<AdminAnnouncement["status"], StatusVariant> = {
  draft: "draft",
  published: "active",
  archived: "expired",
};

export function releaseVariant(status: AdminRelease["status"]): StatusVariant {
  if (status === "complete") return "success";
  if (status === "gate_failed" || status === "halted") return "failed";
  return "in-progress";
}

/** Dot colour for a channel state. */
export function channelTone(state: string | undefined): string {
  if (state === "connected") return "bg-emerald-500";
  if (state === "failed") return "bg-destructive";
  if (state === "registering" || state === "connecting") return "bg-amber-500";
  return "bg-muted-foreground/30";
}

/** Tick health: green within the sweep's rhythm, amber when it is late, red when it fails. */
export function tickTone(tenant: Pick<AdminTenant, "tickFailures" | "tickSucceededAt">, now: number = Date.now()): string {
  if (tenant.tickFailures > 0) return "text-destructive";
  if (!tenant.tickSucceededAt) return "text-muted-foreground";
  return now - Date.parse(tenant.tickSucceededAt) > TICK_STALE_MS ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
}

// ── Announcements ───────────────────────────────────────────────────

/** "Beta · Pro · solo dueños", or "Todos los clientes". */
export function audienceSummary(audience: AdminAnnouncementAudience, locale: AdminLocale = "es"): string {
  const en = locale === "en";
  const parts: string[] = [];
  const chosen = audience.tenants?.length ?? 0;
  if (chosen) parts.push(en ? `${chosen} chosen ${chosen === 1 ? "customer" : "customers"}` : chosen === 1 ? "1 cliente elegido" : `${chosen} clientes elegidos`);
  if (audience.access) parts.push(audience.access === "beta" ? "Beta" : en ? "Paying" : "Pagando");
  if (audience.plans?.length) parts.push(audience.plans.map((plan) => LABELS[locale].plan[plan]).join(en ? " or " : " o "));
  if (audience.ownersOnly) parts.push(en ? "owners only" : "solo dueños");
  return parts.length ? parts.join(" · ") : en ? "Every customer" : "Todos los clientes";
}

/** Whether a published announcement is showing now, waiting for its start, or over. */
export function liveState(
  announcement: Pick<AdminAnnouncement, "status" | "startsAt" | "endsAt">,
  now: number = Date.now(),
): "live" | "scheduled" | "ended" | null {
  if (announcement.status !== "published") return null;
  if (announcement.endsAt && Date.parse(announcement.endsAt) <= now) return "ended";
  if (announcement.startsAt && Date.parse(announcement.startsAt) > now) return "scheduled";
  return "live";
}

/** Followed / seen, as a whole percentage; "—" before anyone saw it. */
export function clickRate(stats: AdminAnnouncement["stats"]): string {
  return stats.seen ? `${Math.round((stats.clicked / stats.seen) * 100)}%` : "—";
}

/** The fleet's reason a slug cannot name a new tenant (oruka-fleet src/validate.ts), for the operator. */
export function slugReasonLabel(reason: string | null, locale: AdminLocale = "es"): string {
  const en = locale === "en";
  if (!reason) return "";
  if (reason === "taken") return en ? "That subdomain is already taken." : "Ese subdominio ya está en uso.";
  if (reason.includes("reserved")) return en ? "That name is reserved for Oruka." : "Ese nombre está reservado para Oruka.";
  if (reason.includes("webhook URL")) return en ? "Too long for the WhatsApp webhook." : "Es demasiado largo para el webhook de WhatsApp.";
  return en
    ? "Use 1 to 32 lowercase letters, numbers or hyphens, with no hyphen at either end."
    : "Usa de 1 a 32 letras minúsculas, números o guiones, sin guion al inicio ni al final.";
}

/** A first slug for a company name: "Café Andino" -> "cafe-andino". */
export function suggestSlug(company: string): string {
  return company
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** Monthly recurring revenue for the Customers header (lib/admin-overview.ts revenueOf). */
export function revenueHint(revenue: Revenue, locale: AdminLocale = "es"): string {
  const en = locale === "en";
  if (revenue.source === "estimate") {
    const missing = revenue.missing ? ` · ${revenue.missing} ${en ? "without a real Stripe amount" : "sin importe real de Stripe"}` : "";
    return `${en ? "Estimated MRR" : "MRR estimado"} ${formatUsd(revenue.monthly)}${missing}`;
  }
  const amounts = revenue.byCurrency.length
    ? revenue.byCurrency.map(({ monthly, currency }) => formatMoney(monthly, currency, locale)).join(" + ")
    : formatUsd(0);
  const label = revenue.sandbox ? (en ? "Test MRR (Stripe sandbox)" : "MRR de prueba (Stripe sandbox)") : "MRR";
  const ending = revenue.ending ? ` · ${revenue.ending} ${en ? "cancel at period end" : "cancela al cierre"}` : "";
  return `${label} ${amounts}${ending}`;
}
