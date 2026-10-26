import { adminLocale, adminTitle } from "@/lib/admin-locale-server";
import { notFound } from "next/navigation";
import { FleetAdminError, fleetAdmin, fleetAdminConfigured, verifiedOperator } from "@/lib/admin";
import type { AdminTenantDetail } from "@/lib/admin-types";
import { getAccessRequest } from "@/lib/access-requests";
import { RequestDetail } from "../../_components/request-detail";
import type { Installation } from "../../_components/request-admission";

export const generateMetadata = () => adminTitle("Solicitud", "Request");

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await verifiedOperator())) return null;
  const { id } = await params;
  if (!/^req_[\w-]{20}$/.test(id)) notFound();
  const request = await getAccessRequest(id);
  if (!request) notFound();
  return <RequestDetail key={`${request.id}:${request.revision}`} request={request} installation={await installationOf(request.admission?.tenantId)} />;
}

/** The admitted request's installation as the fleet sees it now; the request page still renders without it. */
async function installationOf(tenantId: string | undefined): Promise<Installation> {
  const configured = fleetAdminConfigured();
  if (!tenantId || !configured) return { configured, detail: null, error: null };
  try {
    return { configured, detail: await fleetAdmin<AdminTenantDetail>(`tenant?id=${encodeURIComponent(tenantId)}`), error: null };
  } catch (error) {
    const unknown = (await adminLocale()) === "en" ? "Unknown error." : "Error desconocido.";
    return { configured, detail: null, error: error instanceof FleetAdminError ? error.message : unknown };
  }
}
