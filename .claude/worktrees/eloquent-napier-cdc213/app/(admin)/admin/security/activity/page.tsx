import { adminLocale, adminTitle } from "@/lib/admin-locale-server";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, operatorEmails, verifiedOperator } from "@/lib/admin";
import { accessRequestActivity } from "@/lib/access-requests";
import {
  ACTIVITY_AREAS, ACTIVITY_PAGE, FLEET_PREFIXES, mergeActivity, type ActivityArea, type FleetActivity,
} from "@/lib/admin-activity";
import { ActivityLog, type ActivityFilters } from "../../_components/activity-log";

export const generateMetadata = () => adminTitle("Actividad", "Activity");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A Bogotá calendar day's start, as an instant (Colombia has no daylight saving). */
const dayStart = (day: string) => new Date(`${day}T00:00:00.000-05:00`).toISOString();

/**
 * What every operator did, newest first: tenants, requests, announcements
 * and release requests (lib/admin-activity.ts). Filters by area, operator
 * and Bogotá day; pages back 50 at a time. Read before anything renders,
 * after the operator passed 2FA, like every panel page.
 */
export default async function AdminActivityPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await verifiedOperator())) return null;
  const locale = await adminLocale();
  const tr = (es: string, en: string) => (locale === "en" ? en : es);
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const operators = operatorEmails();
  // Any operator's email, including one no longer in ORUKA_ADMIN_EMAILS whose actions remain.
  const askedActor = one("actor").trim().toLowerCase();
  const filters: ActivityFilters = {
    area: ACTIVITY_AREAS.find((value) => value === one("area")) ?? "all",
    actor: /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(askedActor) ? askedActor : "",
    from: DAY.test(one("from")) ? one("from") : "",
    to: DAY.test(one("to")) ? one("to") : "",
  };
  // The page's cursor, or the day after `to`, whichever comes first.
  const cursor = Number.isFinite(Date.parse(one("before"))) ? new Date(one("before")).toISOString() : null;
  const end = filters.to ? new Date(Date.parse(dayStart(filters.to)) + 86_400_000).toISOString() : null;
  const before = cursor && end ? (cursor < end ? cursor : end) : cursor ?? end;

  const wantsFleet = filters.area !== "solicitudes";
  const wantsRequests = filters.area === "all" || filters.area === "solicitudes";
  let fleet: FleetActivity[] = [];
  let fleetError: string | null = null;
  if (wantsFleet && fleetAdminConfigured()) {
    const query = new URLSearchParams({ limit: String(ACTIVITY_PAGE + 1) });
    if (before) query.set("before", before);
    if (filters.actor) query.set("actor", filters.actor);
    const prefixes = filters.area === "all" ? null : FLEET_PREFIXES[filters.area as ActivityArea];
    if (prefixes) query.set("action", prefixes);
    try {
      fleet = (await fleetAdmin<{ entries: FleetActivity[] }>(`activity?${query}`)).entries;
    } catch (error) {
      fleetError = error instanceof FleetAdminError
        ? error.status === 404
          ? tr("El fleet todavía no registra actividad: publica su versión nueva.", "The fleet does not record activity yet: deploy its new version.")
          : error.message
        : tr("Error desconocido.", "Unknown error.");
    }
  } else if (wantsFleet) {
    fleetError = tr(
      "Falta conectar el panel con el fleet: solo se ve la actividad de las solicitudes.",
      "The panel is not connected to the fleet: only request activity shows.",
    );
  }
  const requests = wantsRequests ? await accessRequestActivity({ before, actor: filters.actor || null }) : [];
  const page = mergeActivity(fleet, requests, { from: filters.from ? dayStart(filters.from) : null, locale });
  const actors = [...new Set([...operators, ...page.items.flatMap((item) => (item.actor ? [item.actor] : [])), ...(filters.actor ? [filters.actor] : [])])];
  return <ActivityLog items={page.items} next={page.next} filters={filters} operators={actors} fleetError={fleetError} paged={Boolean(cursor)} />;
}
