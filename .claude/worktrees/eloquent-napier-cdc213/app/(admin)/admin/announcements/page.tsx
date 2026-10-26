import { adminTitle } from "@/lib/admin-locale-server";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminAnnouncement } from "@/lib/admin-types";
import { AnnouncementsList } from "../_components/announcements-list";
import { FleetUnavailable } from "../_components/fleet-unavailable";

export const generateMetadata = () => adminTitle("Anuncios", "Announcements");

export default async function AdminAnnouncementsPage() {
  // The layout shows the second-factor step instead; never fetch the fleet before it.
  if (!(await verifiedOperator())) return null;
  if (!fleetAdminConfigured()) return <FleetUnavailable reason="not_configured" />;
  let announcements: readonly AdminAnnouncement[];
  try {
    ({ announcements } = await fleetAdmin<{ announcements: AdminAnnouncement[] }>("announcements"));
  } catch (error) {
    return <FleetUnavailable reason={error instanceof FleetAdminError ? error.message : null} />;
  }
  return <AnnouncementsList announcements={announcements} />;
}
