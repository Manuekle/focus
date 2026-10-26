import "../product.css";
import { cookies } from "next/headers";
import { AgentChat, type AgentAuthMode } from "@/app/_components/agent-chat";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/store";

export default async function Page() {
  const credentialsConfigured = Boolean(
    process.env.ROUTE_AUTH_BASIC_USER?.trim() && process.env.ROUTE_AUTH_BASIC_PASSWORD,
  );
  // A signed-in Oruka account (email/password or Google) is enough on its
  // own — see the matching appSession() check in agent/channels/eve.ts.
  // Nobody who already has a session should also have to type the separate
  // Basic-auth password.
  const hasOrukaSession = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);

  const authMode: AgentAuthMode =
    process.env.NODE_ENV !== "production"
      ? "local"
      : hasOrukaSession
        ? "session"
        : credentialsConfigured
          ? "basic"
          : "misconfigured";

  return <AgentChat authMode={authMode} />;
}
