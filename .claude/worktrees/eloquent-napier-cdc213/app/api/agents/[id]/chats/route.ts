import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { deleteAgentChat, getAgent, listAgentChats, saveAgentChat } from "@/lib/business-store";
import type { AgentChatTurn } from "@/lib/types";

// The saved transcripts of one agent's playground chats — the text
// counterpart to .../voice/calls.
//
// POST replaces a session's turns rather than appending to them: the browser
// holds the whole conversation while it is open and sends all of it after
// each answer, so a retried save cannot produce two copies of the same reply.
// It answers with the session so the first save hands the browser the id the
// following ones write to.

/** Guard against a conversation growing past what a saved transcript is for. */
const MAX_TURNS = 200;

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!(await getAgent(id))) return apiError("not_found");
  return NextResponse.json({ chats: await listAgentChats(id) });
});

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!(await getAgent(id))) return apiError("not_found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const input = body as { sessionId?: unknown; turns?: unknown };
  if (!Array.isArray(input.turns)) return missingField("turns");

  const turns: AgentChatTurn[] = input.turns
    .filter((turn): turn is { role: unknown; content: unknown } => !!turn && typeof turn === "object")
    .filter(
      (turn) =>
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim().length > 0,
    )
    .slice(-MAX_TURNS)
    .map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: (turn.content as string).trim(),
    }));

  if (turns.length === 0) return missingField("turns");

  const chat = await saveAgentChat({
    sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
    agentId: id,
    turns,
  });
  return NextResponse.json({ ok: true, chat });
});

export const DELETE = withApiErrors(async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return missingField("sessionId");
  if (!(await deleteAgentChat(id, sessionId))) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
