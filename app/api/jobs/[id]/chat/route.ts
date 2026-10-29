import { ChatRequestSchema } from "../../../../../shared/schemas";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardChatRequest, readJsonBody } from "../../../../../server/guard";
import { chatEdit, restoreChatTurn } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

/** One AI editor turn, or a restore of an earlier turn's render (free). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const parsed = ChatRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_chat", 400, "Describe what you want to change (2 to 300 characters).");
    if ("restore" in parsed.data) return Response.json(await restoreChatTurn(id, parsed.data.restore), { status: 202 });
    await guardChatRequest(request);
    return Response.json(await chatEdit(id, parsed.data.message), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
