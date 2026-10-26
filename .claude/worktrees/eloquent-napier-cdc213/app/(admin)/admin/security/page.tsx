import { adminTitle } from "@/lib/admin-locale-server";
import { adminBasePath, verifiedOperator } from "@/lib/admin";
import { SecurityOverview } from "../_components/security-overview";

export const generateMetadata = () => adminTitle("Seguridad", "Security");

/**
 * The operator's own account security: the two-step verification the panel
 * requires (new QR for a new or lost phone, new recovery codes) and a new
 * password from a code when the current one is forgotten. The same card as
 * the account page; the panel loads the product copy for it.
 */
export default async function AdminSecurityPage() {
  const operator = await verifiedOperator();
  if (!operator) return null;
  return <SecurityOverview operator={operator} activityHref={`${await adminBasePath()}/security/activity`} />;
}
