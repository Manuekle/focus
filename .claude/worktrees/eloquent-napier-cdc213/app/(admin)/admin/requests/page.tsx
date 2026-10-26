import { adminTitle } from "@/lib/admin-locale-server";
import { verifiedOperator } from "@/lib/admin";
import { accessRequestsOverview } from "@/lib/access-requests";
import { REQUEST_SOURCES, REQUEST_STATUSES, type AccessRequestFilters } from "@/lib/access-request-types";
import { RequestsOverview } from "../_components/requests-overview";

export const generateMetadata = () => adminTitle("Solicitudes", "Requests");

export default async function AdminRequestsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await verifiedOperator())) return null;
  const params = await searchParams;
  const source = typeof params.source === "string" ? params.source : "";
  const status = typeof params.status === "string" ? params.status : "";
  const filters: AccessRequestFilters = {
    source: source === "all" ? "all" : REQUEST_SOURCES.find((value) => value === source) ?? "early-access",
    status: REQUEST_STATUSES.find((value) => value === status) ?? "all",
    query: typeof params.q === "string" ? params.q.slice(0, 200) : "",
    page: typeof params.page === "string" && /^\d{1,6}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1,
  };
  return <RequestsOverview overview={await accessRequestsOverview(filters)} filters={filters} />;
}
