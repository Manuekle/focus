import { CorrectionSchema, ROTOSCOPE_LIMITS } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { declaredLength } from "../../../../../../server/animation/http";
import { assertRotoscopeEnabled, correctFrame } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** A pencil note on one drawing: the red marks (PNG) and what to change. Reopens the frame for its next drawing. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const bytes = declaredLength(request);
    if (bytes !== undefined && bytes > ROTOSCOPE_LIMITS.maxMarkBytes + 64 * 1024) throw new AppError("upload_too_large", 413, "These pencil marks are too large.");
    const form = await request.formData().catch(() => null);
    const marks = form?.get("marks");
    const fields = CorrectionSchema.safeParse({ frame: form?.get("frame"), attempt: form?.get("attempt"), comment: form?.get("comment") });
    if (!fields.success) throw new AppError("INPUT_INVALID", 400, `Say what to change (up to ${ROTOSCOPE_LIMITS.maxCommentLength} characters).`);
    if (!(marks instanceof File) || marks.size > ROTOSCOPE_LIMITS.maxMarkBytes) throw new AppError("INPUT_INVALID", 400, "Mark the drawing with the pencil first.");
    return Response.json(await correctFrame((await params).id, user.id, { ...fields.data, marks: Buffer.from(await marks.arrayBuffer()) }));
  } catch (error) {
    return errorResponse(error);
  }
}
