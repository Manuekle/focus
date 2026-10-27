import { FrameActionSchema } from "../../../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { guardUpload, readJsonBody } from "../../../../../../server/guard";
import { declaredLength, paidGate, parseFrame } from "../../../../../../server/animation/http";
import { applyFrameAction, replaceFrame } from "../../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string; frame: string }> };

/** Redraw, restore or approve one frame. Other frames are never touched. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id, frame } = await params;
    const parsed = FrameActionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_action", 400, "That frame action isn’t valid. Correction notes are up to 240 characters.");
    const flipbook = await applyFrameAction(id, parseFrame(frame), parsed.data, paidGate(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Replaces the frame with an uploaded drawing (raw image body). */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id, frame } = await params;
    const flipbook = await replaceFrame(id, parseFrame(frame), request.body, declaredLength(request), paidGate(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
