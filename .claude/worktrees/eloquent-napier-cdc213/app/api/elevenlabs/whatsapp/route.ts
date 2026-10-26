import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { type NextRequest, NextResponse } from "next/server";
import { getCredential } from "@/lib/credentials";
import { getAgent } from "@/lib/business-store";
import { apiError, withApiErrors } from "@/lib/api-error";

/** WhatsApp messaging and WhatsApp Calling are separate connections. Only
 * expose the configured business account; never claim calls work just because
 * a Meta messaging token exists. Import requires the owner's Meta login. */
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("agentId");
  if (!id) return apiError("missing_field", { field: "agentId" });
  const agent = await getAgent(id);
  if (!agent) return apiError("not_found");
  const [apiKey, phoneNumberId] = await Promise.all([getCredential("ELEVENLABS_API_KEY"), getCredential("WHATSAPP_PHONE_NUMBER_ID")]);
  if (!apiKey || !phoneNumberId) return NextResponse.json({ ready: false, imported: false, messagingConfigured: Boolean(phoneNumberId) });
  try {
    const client = new ElevenLabsClient({ apiKey });
    const accounts = await client.conversationalAi.whatsappAccounts.list();
    const account = accounts.items.find((a) => a.phoneNumberId === phoneNumberId);
    return NextResponse.json({
      messagingConfigured: true, imported: Boolean(account),
      ready: Boolean(agent.status === "active" && agent.voice?.enabled && agent.voice?.elevenlabsAgentId && account?.assignedAgentId === agent.voice?.elevenlabsAgentId && account?.enableMessaging === false && !account?.isTokenExpired),
      ...(account ? { phone: account.phoneNumber, tokenExpired: Boolean(account.isTokenExpired), messagingEnabled: Boolean(account.enableMessaging) } : {}),
    });
  } catch { return apiError("upstream_failed"); }
});
