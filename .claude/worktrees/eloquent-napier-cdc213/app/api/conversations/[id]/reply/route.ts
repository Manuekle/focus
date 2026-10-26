import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { appendConversationTurn, getChannelConversation, getContact, upsertChat, upsertContact } from "@/lib/business-store";
import { replyToContact } from "@/lib/automation-runner";

// POST /api/conversations/[id]/reply
// A person on the team answers the customer on their own channel. This is the
// other half of a handoff: the agent said a teammate would take over, and
// this is where one does. Sending also pauses the agent for this contact, so
// the two never answer the same message; "Reanudar agente" hands it back.

const MAX_LENGTH = 4000;

export const POST = withApiErrors(async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const text = typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text.trim() : "";
  if (!text || text.length > MAX_LENGTH) return apiError("invalid_field", { field: "text" });

  const conversation = await getChannelConversation(id);
  if (!conversation) return apiError("not_found");
  if (conversation.channel === "web") {
    return apiError("invalid_field", { field: "channel", message: "Web chat has no outbound channel to reply on." });
  }
  const contact = conversation.contactId ? await getContact(conversation.contactId) : undefined;
  if (!contact) return apiError("invalid_field", { field: "contact", message: "This conversation has no saved contact to reply to." });

  const delivery = await replyToContact(contact, text);
  if (!delivery?.ok) {
    return apiError("upstream_failed", { message: delivery?.detail ?? "No outbound channel for this contact." });
  }
  const at = new Date().toISOString();
  await appendConversationTurn({
    sessionId: conversation.sessionId, channel: conversation.channel, role: "assistant",
    content: text, contactId: contact.id, human: true,
  });
  await upsertChat({ sessionId: conversation.sessionId, lastMessage: text, lastMessageAt: at, handoff: true });
  if (contact.status !== "waiting_human") await upsertContact({ id: contact.id, status: "waiting_human" });
  return NextResponse.json({ ok: true, detail: delivery.detail });
});
