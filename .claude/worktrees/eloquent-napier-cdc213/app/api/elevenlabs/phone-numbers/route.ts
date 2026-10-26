import { requireOwner } from "@/lib/owner-gate";
import { getAgentByElevenLabsAgentId } from "@/lib/business-store";
import { getCredential } from "@/lib/credentials";
import {
  ELEVENLABS_SCOPES,
  hasVoicePlatform,
  importTwilioNumber,
  listPhoneNumbers,
} from "@/lib/elevenlabs-agents";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure, withApiErrors } from "@/lib/api-error";

/** Numbers already imported into the ElevenLabs account. */
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const denied = await requireOwner(request);
  if (denied) return denied;
  if (!(await hasVoicePlatform())) {
    return NextResponse.json({ configured: false, numbers: [] });
  }
  try {
    const numbers = await listPhoneNumbers();
    return NextResponse.json({ configured: true, numbers });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const perm = msg.match(/permission (\w+)/)?.[1];
    if (perm || msg.includes("missing_permissions") || msg.includes("unauthorized")) {
      return apiError("elevenlabs_permission", { detail: msg, field: perm ?? ELEVENLABS_SCOPES });
    }
    return apiFailure(error, "upstream_failed");
  }
});

/**
 * Import the Twilio number configured in Settings into ElevenLabs.
 *
 * The credentials are read server-side rather than posted from the browser:
 * they are already stored, and a form that re-asks for an auth token is a form
 * that puts an auth token in a request log.
 */
export const POST = withApiErrors(async function POST(request: NextRequest) {
  const denied = await requireOwner(request);
  if (denied) return denied;
  if (!(await hasVoicePlatform())) {
    return apiError("not_configured", {
      message: "Add an ElevenLabs API key in Settings first.",
    });
  }

  const [sid, token, phoneNumber] = await Promise.all([
    getCredential("TWILIO_ACCOUNT_SID"),
    getCredential("TWILIO_AUTH_TOKEN"),
    getCredential("TWILIO_PHONE_NUMBER"),
  ]);
  if (!sid || !token || !phoneNumber) {
    return apiError("not_configured", {
      message: "Fill in the Twilio credentials in Settings first.",
    });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // An empty body is fine: import the number without routing it anywhere.
  }
  const agentId = (body as { elevenlabsAgentId?: unknown } | null)?.elevenlabsAgentId;
  if (agentId !== undefined) {
    if (typeof agentId !== "string" || !agentId) return apiError("invalid_body");
    const agent = await getAgentByElevenLabsAgentId(agentId);
    if (!agent || agent.status !== "active" || !agent.voice?.enabled) return apiError("conflict");
  }

  try {
    const phoneNumberId = await importTwilioNumber({
      phoneNumber,
      label: "oruka",
      sid,
      token,
      agentId: typeof agentId === "string" && agentId ? agentId : undefined,
    });
    return NextResponse.json({ ok: true, phoneNumberId, phoneNumber });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const perm = msg.match(/permission (\w+)/)?.[1];
    if (perm || msg.includes("missing_permissions") || msg.includes("unauthorized")) {
      return apiError("elevenlabs_permission", { detail: msg, field: perm ?? ELEVENLABS_SCOPES });
    }
    return apiFailure(error, "upstream_failed");
  }
});
