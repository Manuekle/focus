import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { listChannelConversations } from "@/lib/business-store";

// GET /api/conversations
// The real conversations the agent has held on the connected channels, as a
// list. Turns are left out on purpose: the list is a sidebar, and a hundred
// full transcripts is not what a sidebar needs — .../[id] serves one.

export const GET = withApiErrors(async function GET() {
  const conversations = await listChannelConversations();
  return NextResponse.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      sessionId: conversation.sessionId,
      channel: conversation.channel,
      contactId: conversation.contactId,
      title: conversation.title,
      turnCount: conversation.turns.length,
      lastMessage: conversation.turns.at(-1)?.content.slice(0, 160) ?? "",
      startedAt: conversation.startedAt,
      updatedAt: conversation.updatedAt,
      prospect: conversation.prospect,
    })),
  });
});
