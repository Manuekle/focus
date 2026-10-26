"use client";

import { Alert } from "@/components/ui/alert";
import { useAdminLocale } from "./admin-locale";

/**
 * What the panel shows when it cannot read the fleet: unset env (with the
 * names to set) or the fleet's own answer. Never a token's value. `null`
 * is an error that did not come from the fleet.
 */
export function FleetUnavailable({ reason }: { readonly reason: "not_configured" | string | null }) {
  const { tr } = useAdminLocale();
  if (reason === "not_configured") {
    return (
      <Alert tone="warning" title={tr("Falta conectar el panel con el fleet", "The panel is not connected to the fleet")}>
        {tr("Configura", "Set")} <code className="font-mono">ORUKA_FLEET_ADMIN_TOKEN</code> {tr("en este proyecto y el mismo valor como", "in this project and the same value as")}{" "}
        <code className="font-mono">FLEET_ADMIN_TOKEN</code> {tr("en", "in")} <code className="font-mono">oruka-fleet</code>{" "}
        {tr("(32 caracteres o más).", "(32 characters or more).")} <code className="font-mono">ORUKA_FLEET_URL</code>{" "}
        {tr("ya apunta al fleet en www.", "already points at the fleet on www.")}
      </Alert>
    );
  }
  return (
    <Alert tone="error" title={tr("El fleet no respondió", "The fleet did not answer")}>
      {reason ?? tr("Error desconocido.", "Unknown error.")}
    </Alert>
  );
}
