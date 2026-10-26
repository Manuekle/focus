import type { AdminLocale } from "@/lib/admin-locale";
import type { AdminEvent } from "@/lib/admin-types";
import { adminLabels } from "./format";
import { FEATURES } from "@/lib/features";

// A customer's registry journal (oruka-fleet `events`) and provisioning steps
// in words: the raw kind stays available as a tooltip, but the operator reads
// "Versión 629c3d0 instalada", not `release.deployed sha: 629c3d0…`.

type Pair = readonly [es: string, en: string];

const STEP: Record<string, Pair> = {
  neon_project: ["Base de datos (Neon)", "Database (Neon)"],
  vercel_project: ["Proyecto en Vercel", "Vercel project"],
  env: ["Variables de entorno", "Environment variables"],
  domain: ["Dominio", "Domain"],
  deploy: ["Primer despliegue", "First deploy"],
  health: ["Comprobación de salud", "Health check"],
  config: ["Configuración inicial", "Initial configuration"],
  owner: ["Invitación al dueño", "Owner invitation"],
};

export function stepLabel(step: string, locale: AdminLocale): string {
  const pair = STEP[step];
  return pair ? pair[locale === "en" ? 1 : 0] : step;
}

/** What a configuration push answered (oruka-fleet pushConfig). */
export const PUSH_LABEL: Record<string, Pair> = {
  applied: ["la instalación la aplicó", "the install applied it"],
  unsupported: ["la versión instalada todavía no la admite", "the installed version does not support it yet"],
  failed: ["no respondió; el fleet reintenta en 15 minutos", "no answer; the fleet retries in 15 minutes"],
  skipped: ["la instalación todavía no está desplegada", "the install is not deployed yet"],
  none: ["el fleet no tiene FLEET_TOKEN_SECRET", "the fleet has no FLEET_TOKEN_SECRET"],
  unchanged: ["ya estaba así; no hizo falta enviar nada", "it was already set; nothing to send"],
};

export type EventTone = "neutral" | "good" | "bad";
export type EventLine = { readonly title: string; readonly detail: string | null; readonly tone: EventTone };

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null);
const sha = (value: unknown): string => (typeof value === "string" ? value.slice(0, 7) : "—");
const join = (...parts: (string | null | undefined | false)[]): string | null => parts.filter(Boolean).join(" · ") || null;

export function describeEvent(event: Pick<AdminEvent, "kind" | "detail">, locale: AdminLocale): EventLine {
  const en = locale === "en";
  const t = (es: string, english: string) => (en ? english : es);
  const d = event.detail;
  const labels = adminLabels(locale);
  const actor = str(d.actor);
  const plan = (value: unknown) => labels.plan[str(value) ?? ""] ?? str(value) ?? "—";
  const line = (title: string, detail: string | null = null, tone: EventTone = "neutral"): EventLine => ({ title, detail, tone });
  const channel = event.kind.split(".")[0] === "whatsapp" ? "WhatsApp" : "Instagram";

  switch (event.kind) {
    case "created":
      return line(t("Instalación creada", "Install created"), join(`Plan ${plan(d.plan)}`, d.isTest === true && t("de prueba", "test")));
    case "transition": {
      const to = str(d.to);
      return line(`${t("Estado", "Status")}: ${to ? (labels.status as Record<string, string>)[to] ?? to : "—"}`, null, to === "failed" ? "bad" : "neutral");
    }
    case "step.done":
      return line(`${t("Paso listo", "Step done")}: ${stepLabel(str(d.step) ?? "", locale)}`);
    case "step.failed":
      return line(`${t("Paso falló", "Step failed")}: ${stepLabel(str(d.step) ?? "", locale)}`, str(d.error), "bad");
    case "release.deployed":
      return line(t(`Versión ${sha(d.sha)} instalada`, `Version ${sha(d.sha)} installed`), str(d.releaseId) && `release #${str(d.releaseId)}`, "good");
    case "release.failed":
      return line(
        t(`Falló la instalación de ${sha(d.sha)}`, `Installing ${sha(d.sha)} failed`),
        join(str(d.reason), d.live === true && t("quedó en vivo", "left live")),
        "bad",
      );
    case "release.gate_failed":
      return line(t(`${sha(d.sha)} no pasó la verificación`, `${sha(d.sha)} failed the check`), str(d.reason), "bad");
    case "admin.plan":
      return line(t(`Plan cambiado de ${plan(d.from)} a ${plan(d.to)}`, `Plan changed from ${plan(d.from)} to ${plan(d.to)}`), actor);
    case "admin.feature": {
      const feature = FEATURES.find((entry) => entry.id === str(d.feature));
      const name = feature ? feature.name[en ? "en" : "es"] : str(d.feature) ?? "?";
      const state = (value: unknown) =>
        value === true ? t("activada", "on") : value === false ? t("apagada", "off") : t("por defecto", "default");
      return line(`${name}: ${state(d.to)}`, join(t(`antes ${state(d.from)}`, `was ${state(d.from)}`), actor));
    }
    case "admin.config_pushed": {
      const push = PUSH_LABEL[str(d.push) ?? ""];
      return line(
        t(`Configuración v${str(d.version) ?? "?"} reenviada`, `Configuration v${str(d.version) ?? "?"} sent again`),
        join(push ? push[en ? 1 : 0] : str(d.push), actor),
        str(d.push) === "applied" ? "good" : str(d.push) === "failed" ? "bad" : "neutral",
      );
    }
    case "admin.admitted":
      return line(t("Creada desde una solicitud de beta", "Created from a beta request"), join(`Plan ${plan(d.plan)}`, actor));
    case "owner.reinvited":
      return line(t("Invitación reenviada al dueño", "Invitation sent to the owner again"), join(str(d.via) && `${t("vía", "via")} ${str(d.via)}`, actor));
    case "owner.reinvite_failed":
      return line(t("No se pudo reenviar la invitación", "Could not resend the invitation"), str(d.error), "bad");
    case "env.refreshed":
      return line(t("Variables de entorno actualizadas", "Environment variables updated"), Array.isArray(d.keys) ? t(`${d.keys.length} variables`, `${d.keys.length} variables`) : str(d.keys) && `${str(d.keys)} variables`);
    case "env.meta_secrets_removal_failed":
      return line(t("No se pudieron quitar los secretos de Meta", "Could not remove the Meta secrets"), null, "bad");
    case "billing.linked":
      return line(t("Suscripción de Stripe vinculada", "Stripe subscription linked"));
    case "billing.plan_written":
    case "billing.plan_applied":
    case "billing.plan_pushed":
      return line(t(`Plan de la suscripción: ${plan(d.envPlan)}`, `Subscription plan: ${plan(d.envPlan)}`));
    case "billing.portal_opened":
      return line(t("El dueño abrió el portal de pagos", "The owner opened the billing portal"));
    case "whatsapp.mapped":
    case "instagram.mapped":
      return line(t(`${channel} conectado`, `${channel} connected`), null, "good");
    case "whatsapp.released":
    case "instagram.released":
      return line(t(`${channel} desconectado`, `${channel} disconnected`));
    case "health.stale_notified":
      return line(t("Aviso: las tareas programadas no corren", "Alert: scheduled work is not running"), str(d.failures) && t(`${str(d.failures)} fallos seguidos`, `${str(d.failures)} failures in a row`), "bad");
    case "provisioning.gave_up":
      return line(t("El aprovisionamiento se detuvo", "Provisioning gave up"), str(d.failures) && t(`tras ${str(d.failures)} intentos`, `after ${str(d.failures)} attempts`), "bad");
    case "workspace.reminded":
      return line(t("Se le recordó su dirección al dueño", "The owner was reminded of their address"));
    default:
      return line(
        event.kind,
        Object.entries(d)
          .filter(([, value]) => value !== null && value !== undefined && value !== "")
          .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
          .join(" · ") || null,
      );
  }
}
