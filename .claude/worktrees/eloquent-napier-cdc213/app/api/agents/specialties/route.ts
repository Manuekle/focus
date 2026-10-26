import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { AgentAssignmentError, setSpecialtyAgent } from "@/lib/business-store";
import { isAgentSpecialty } from "@/lib/agent-routing";

// Which agent takes over each kind of conversation: a purchase, a booking, a
// problem with something already bought. The runtime half is
// lib/agent-routing.ts; this is the owner's switch for it, next to the one
// that assigns channels (app/api/channels/agents).
//
//   PUT {specialty, agentId | null}  → {agents}

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = body as { specialty?: unknown; agentId?: unknown } | null;
  if (!isAgentSpecialty(input?.specialty)) return missingField("specialty");

  // `null` turns the specialty off, so an absent field is the error.
  const agentId = input?.agentId;
  if (agentId !== null && typeof agentId !== "string") return missingField("agentId");

  try {
    const agents = await setSpecialtyAgent(input.specialty, agentId);
    return NextResponse.json({ agents });
  } catch (error) {
    if (error instanceof AgentAssignmentError) {
      return error.reason === "not_found"
        ? apiError("not_found", { message: error.message })
        : apiError("conflict", { message: error.message });
    }
    throw error;
  }
});
