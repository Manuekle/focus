import { adminTitle } from "@/lib/admin-locale-server";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminOverview } from "@/lib/admin-types";
import { FleetUnavailable } from "./_components/fleet-unavailable";
import { TenantsOverview } from "./_components/tenants-overview";
import { salesOpen } from "@/lib/sales";

export const generateMetadata = () => adminTitle("Clientes", "Customers");

export default async function AdminHomePage() {
  // The layout shows the second-factor step instead; never fetch the fleet before it.
  if (!(await verifiedOperator())) return null;
  if (!fleetAdminConfigured()) return <FleetUnavailable reason="not_configured" />;
  let overview: AdminOverview;
  try {
    overview = await fleetAdmin<AdminOverview>("overview");
  } catch (error) {
    return <FleetUnavailable reason={error instanceof FleetAdminError ? error.message : null} />;
  }
  return <TenantsOverview overview={overview} salesEnabled={salesOpen()} />;
}
