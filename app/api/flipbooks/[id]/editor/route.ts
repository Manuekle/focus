import { SendToEditorRequestSchema } from "../../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardUpload, readJsonBody } from "../../../../../server/guard";
import { sendToEditor } from "../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** Renders the animation as an MP4 and opens it as a new clip in the video editor. Local work only. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    const parsed = SendToEditorRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_export", 400, "Those settings aren’t valid.");
    const { flipbook, video } = await sendToEditor(id, parsed.data);
    return Response.json({ flipbook, video }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
