import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getChannelConversation } from "@/lib/business-store";

// GET /api/conversations/[id]
// One real conversation, with its full transcript. The viewer polls this
// while it is open, which is what makes a live chat readable as it happens.

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const conversation = await getChannelConversation(id);
  if (!conversation) return apiError("not_found");
  return NextResponse.json({ conversation });
});
