import { adminTitle } from "@/lib/admin-locale-server";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminDeployments, AdminOverview } from "@/lib/admin-types";
import { FleetUnavailable } from "../_components/fleet-unavailable";
import { Deployments } from "../_components/deployments";

export const generateMetadata = () => adminTitle("Despliegues", "Deployments");

export default async function DeploymentsPage() {
  if (!(await verifiedOperator())) return null;
  if (!fleetAdminConfigured()) return <FleetUnavailable reason="not_configured" />;
  let data: [AdminDeployments, AdminOverview];
  try {
    data = await Promise.all([
      fleetAdmin<AdminDeployments>("deployments"), fleetAdmin<AdminOverview>("overview"),
    ]);
  } catch (error) {
    return <FleetUnavailable reason={error instanceof FleetAdminError ? error.message : null} />;
  }
  return <Deployments deployment={data[0]} overview={data[1]} />;
}
