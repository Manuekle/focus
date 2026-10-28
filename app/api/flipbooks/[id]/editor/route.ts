import { SendToEditorRequestSchema } from "../../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardRender, guardUpload, readJsonBody } from "../../../../../server/guard";
import { sendToEditor } from "../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../server/animation/access";

type Context = { params: Promise<{ id: string }> };

/** Renders the animation as an MP4 and opens it as a new clip in the video editor. Local work only. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    await requireFlipbookAccess(request, id);
    const parsed = SendToEditorRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_export", 400, "Those settings aren’t valid.");
    const { flipbook, video } = await sendToEditor(id, parsed.data, { signal: request.signal, beforeRender: () => guardRender(request) });
    return Response.json({ flipbook, video }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
