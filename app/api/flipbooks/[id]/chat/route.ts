import { FlipbookChatRequestSchema } from "../../../../../shared/flipbook-chat";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardChatRequest, readJsonBody } from "../../../../../server/guard";
import { proposeChange } from "../../../../../server/animation/chat";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../server/animation/access";

type Context = { params: Promise<{ id: string }> };

/**
 * One chat message about the movement. Returns a proposal (poses to redraw,
 * playback changes, and what it costs in drawings); nothing is drawn or saved.
 * One small Muse Spark call, on the same hourly window as the video editor's chat.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const flipbook = await requireFlipbookAccess(request, id);
    const parsed = FlipbookChatRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_message", 400, "Write what you want changed in a few words.");
    if (!flipbook.plan) throw new AppError("flipbook_not_ready", 409, "The pose plan isn’t ready yet.");
    if (flipbook.cast.length) throw new AppError("not_for_scenes", 409, "The movement chat isn’t available for a scene with several characters yet. Redraw a drawing with a note instead.");
    await guardChatRequest(request);
    const proposal = await proposeChange({ flipbook, ...parsed.data, signal: request.signal });
    return Response.json(proposal, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
