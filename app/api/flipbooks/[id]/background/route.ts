import { errorResponse } from "../../../../../server/errors";
import { guardUpload } from "../../../../../server/guard";
import { declaredLength } from "../../../../../server/animation/http";
import { uploadBackground } from "../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** A custom static background layer (raw image body). No AI call. */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    const flipbook = await uploadBackground(id, request.body, declaredLength(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
