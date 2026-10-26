import { adminTitle } from "@/lib/admin-locale-server";
import { verifiedOperator } from "@/lib/admin";
import { adminCallsState, calBookingUrl, parseCallsFilters } from "@/lib/admin-calls";
import { CallsOverview } from "../_components/calls-overview";

export const generateMetadata = () => adminTitle("Llamadas", "Calls");

export default async function CallsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await verifiedOperator())) return null;
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["status", "cursor", "attendeeEmail"]) if (typeof params[key] === "string") query.set(key, params[key]);
  const filters = parseCallsFilters(query) ?? { status: "upcoming", cursor: null };
  return <CallsOverview result={await adminCallsState(filters)} filters={filters} bookingUrl={calBookingUrl()} />;
}
