import { adminTitle } from "@/lib/admin-locale-server";
import { notFound } from "next/navigation";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminAnnouncement, AdminOverview } from "@/lib/admin-types";
import { AnnouncementEditor } from "../../_components/announcement-editor";
import { FleetUnavailable } from "../../_components/fleet-unavailable";

export const generateMetadata = () => adminTitle("Anuncio", "Announcement");

export default async function AdminAnnouncementPage({ params }: { readonly params: Promise<{ id: string }> }) {
  // The layout shows the second-factor step instead; never fetch the fleet before it.
  if (!(await verifiedOperator())) return null;
  const { id } = await params;
  if (!/^a_[a-f0-9]{16}$/.test(id)) notFound();
  if (!fleetAdminConfigured()) return <FleetUnavailable reason="not_configured" />;
  let announcements: readonly AdminAnnouncement[];
  let overview: AdminOverview;
  try {
    [{ announcements }, overview] = await Promise.all([
      fleetAdmin<{ announcements: AdminAnnouncement[] }>("announcements"),
      fleetAdmin<AdminOverview>("overview"),
    ]);
  } catch (error) {
    return <FleetUnavailable reason={error instanceof FleetAdminError ? error.message : null} />;
  }
  const announcement = announcements.find((entry) => entry.id === id);
  if (!announcement) notFound();
  return <AnnouncementEditor announcement={announcement} tenants={overview.tenants} />;
}
