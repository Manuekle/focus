import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { CAPABILITIES } from "@/lib/agent-capabilities";
import { getStoredConnection } from "@/lib/connection-store";
import { getCredential } from "@/lib/credentials";

// GET /api/agents/capabilities — the picker's catalog, with each entry marked
// as configured or not.
//
// The "configured" flag is what stops the picker from being a wish list: an
// installation with no Stripe key can still tick "Cobrar", but it sees that
// the integration behind it is missing before the agent promises a customer a
// link that will never be created. Any one of a capability's credentials
// counts — payments works on Stripe or on Mercado Pago, and a Latin American
// installation with only Mercado Pago is fully configured, not half.
//
// A connected account counts the same way, and has to: calendar runs on a
// Google account connected from Connections *or* on a service account key in
// Settings, and reading only the Settings half told someone who had connected
// Google that their working calendar was unconfigured. A connection that has
// gone stale does not count — `needsReconnect` is set when a refresh failed,
// which is the same as not being connected until someone grants again.

export const dynamic = "force-dynamic";

export const GET = withApiErrors(async function GET() {
  const capabilities = await Promise.all(
    CAPABILITIES.map(async (capability) => {
      const keys = capability.credentials ?? [];
      const connectionIds = capability.connections ?? [];
      const [values, connections] = await Promise.all([
        Promise.all(keys.map((key) => getCredential(key))),
        Promise.all(connectionIds.map((id) => getStoredConnection(id))),
      ]);
      const hasCredential = values.some((value) => Boolean(value?.trim()));
      const hasConnection = connections.some(
        (connection) => Boolean(connection) && !connection?.needsReconnect,
      );
      return {
        id: capability.id,
        labelKey: capability.labelKey,
        descriptionKey: capability.descriptionKey,
        sensitive: capability.sensitive ?? false,
        /** No requirement of either kind means nothing to configure. */
        configured:
          (keys.length === 0 && connectionIds.length === 0) || hasCredential || hasConnection,
        credentials: keys,
      };
    }),
  );

  return NextResponse.json({ capabilities });
});
