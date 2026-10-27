import { errorResponse } from "../../../../../server/errors";
import { guardUpload } from "../../../../../server/guard";
import { declaredLength, paidGate } from "../../../../../server/animation/http";
import { changeReference } from "../../../../../server/animation/flipbooks";
import { readUpload } from "../../../../../server/animation/image-input";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** Uses an uploaded image as the character reference for new drawings. */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    const upload = await readUpload(request.body, declaredLength(request));
    const flipbook = await changeReference(id, "uploaded", { upload }, paidGate(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
