import { adminTitle } from "@/lib/admin-locale-server";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminOverview } from "@/lib/admin-types";
import { AnnouncementEditor } from "../../_components/announcement-editor";
import { FleetUnavailable } from "../../_components/fleet-unavailable";

export const generateMetadata = () => adminTitle("Nuevo anuncio", "New announcement");

export default async function AdminNewAnnouncementPage() {
  // The layout shows the second-factor step instead; never fetch the fleet before it.
  if (!(await verifiedOperator())) return null;
  if (!fleetAdminConfigured()) return <FleetUnavailable reason="not_configured" />;
  let overview: AdminOverview;
  try {
    overview = await fleetAdmin<AdminOverview>("overview");
  } catch (error) {
    return <FleetUnavailable reason={error instanceof FleetAdminError ? error.message : null} />;
  }
  return <AnnouncementEditor announcement={null} tenants={overview.tenants} />;
}
