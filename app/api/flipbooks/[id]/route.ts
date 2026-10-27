import { FlipbookActionSchema } from "../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../server/errors";
import { guardChatRequest, readJsonBody } from "../../../../server/guard";
import { paidGate } from "../../../../server/animation/http";
import {
  cancelFlipbook,
  changeReference,
  createScene,
  generateMissing,
  reorderFrames,
  reviewFlipbook,
} from "../../../../server/animation/flipbooks";
import { assertFlipbookEnabled, getFlipbook } from "../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    return Response.json(await getFlipbook(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Flipbook-wide actions. Paid ones pass the same guards as a new edit. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const parsed = FlipbookActionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_action", 400, "That action isn’t valid.");
    const action = parsed.data;
    const gate = paidGate(request);
    const flipbook =
      action.action === "generate" ? await generateMissing(id, action.confirmExtra === true, gate)
      : action.action === "reorder" ? await reorderFrames(id, action.order)
      : action.action === "reference" ? await changeReference(id, action.kind, { confirmExtra: action.confirmExtra }, gate)
      : action.action === "scene" ? await createScene(id, action.confirmExtra === true, gate)
      : action.action === "review" ? (guardChatRequest(request), await reviewFlipbook(id))
      : await cancelFlipbook(id);
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
