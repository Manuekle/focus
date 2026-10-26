import { adminTitle } from "@/lib/admin-locale-server";
import { notFound } from "next/navigation";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminOverview, AdminTenantDetail } from "@/lib/admin-types";
import { FleetUnavailable } from "../../_components/fleet-unavailable";
import { TenantDetail } from "../../_components/tenant-detail";
import { salesOpen } from "@/lib/sales";

export const generateMetadata = () => adminTitle("Cliente", "Customer");

export default async function AdminTenantPage({ params }: { readonly params: Promise<{ id: string }> }) {
  // The layout shows the second-factor step instead; never fetch the fleet before it.
  if (!(await verifiedOperator())) return null;
  const { id } = await params;
  if (!/^t_[a-z0-9]+$/.test(id)) notFound();
  if (!fleetAdminConfigured()) return <FleetUnavailable reason="not_configured" />;
  // The production commit says whether this install is up to date; the page
  // still renders without it.
  const overview = fleetAdmin<AdminOverview>("overview").catch(() => null);
  let detail: AdminTenantDetail;
  try {
    detail = await fleetAdmin<AdminTenantDetail>(`tenant?id=${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof FleetAdminError && error.status === 404) notFound();
    return <FleetUnavailable reason={error instanceof FleetAdminError ? error.message : null} />;
  }
  return <TenantDetail detail={detail} salesEnabled={salesOpen()} productionCommit={(await overview)?.productionCommit ?? null} />;
}
