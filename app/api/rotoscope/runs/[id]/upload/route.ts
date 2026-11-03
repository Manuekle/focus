import { ROTOSCOPE_LIMITS } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { declaredLength } from "../../../../../../server/animation/http";
import { assertRotoscopeEnabled, uploadAttempt } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** The person's own picture for one frame: kept as its next attempt and approved. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const bytes = declaredLength(request);
    if (bytes !== undefined && bytes > ROTOSCOPE_LIMITS.maxUploadBytes + 64 * 1024) throw new AppError("upload_too_large", 413, "This image is too large (20 MB at most).");
    const form = await request.formData().catch(() => null);
    const image = form?.get("image");
    const frame = Number(form?.get("frame"));
    if (!Number.isInteger(frame) || frame < 1) throw new AppError("INPUT_INVALID", 400, "Say which frame the image is for.");
    if (!(image instanceof File) || !image.size) throw new AppError("INPUT_INVALID", 400, "Choose an image first.");
    if (image.size > ROTOSCOPE_LIMITS.maxUploadBytes) throw new AppError("upload_too_large", 413, "This image is too large (20 MB at most).");
    return Response.json(await uploadAttempt((await params).id, user.id, frame, Buffer.from(await image.arrayBuffer())));
  } catch (error) {
    return errorResponse(error);
  }
}
