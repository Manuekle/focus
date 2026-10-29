import { errorResponse } from "../../../../../server/errors";
import { guardUpload } from "../../../../../server/guard";
import { declaredLength } from "../../../../../server/animation/http";
import { uploadBackground } from "../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../server/animation/access";

type Context = { params: Promise<{ id: string }> };

/** A custom static background layer (raw image body). No AI call. */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    await guardUpload(request);
    const { id } = await params;
    await requireFlipbookAccess(request, id);
    const flipbook = await uploadBackground(id, request.body, declaredLength(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
