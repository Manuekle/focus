import { FRAME_NOTE_LIMITS } from "../../../../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../../../../server/errors";
import { guardUpload } from "../../../../../../../server/guard";
import { declaredLength, paidGate, parseFrame } from "../../../../../../../server/animation/http";
import { correctFrame } from "../../../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../../../server/animation/access";

type Context = { params: Promise<{ id: string; frame: string }> };

/** A pencil note on one drawing: the red marks (PNG) and what to change. Repairs the frame from them. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    await guardUpload(request);
    const { id, frame } = await params;
    await requireFlipbookAccess(request, id);
    const bytes = declaredLength(request);
    if (bytes !== undefined && bytes > FRAME_NOTE_LIMITS.maxMarkBytes + 64 * 1024) throw new AppError("upload_too_large", 413, "These pencil marks are too large.");
    const form = await request.formData().catch(() => null);
    const marks = form?.get("marks");
    const comment = String(form?.get("comment") ?? "").trim();
    if (!comment || comment.length > FRAME_NOTE_LIMITS.maxCommentLength) throw new AppError("invalid_action", 400, `Say what to change (up to ${FRAME_NOTE_LIMITS.maxCommentLength} characters).`);
    if (!(marks instanceof File) || marks.size === 0 || marks.size > FRAME_NOTE_LIMITS.maxMarkBytes) throw new AppError("invalid_action", 400, "Mark the drawing with the pencil first.");
    const flipbook = await correctFrame(id, parseFrame(frame), { comment, marks: Buffer.from(await marks.arrayBuffer()) }, form?.get("confirmExtra") === "true", paidGate(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
