import { errorResponse } from "../../../../../../server/errors";
import { guardUpload } from "../../../../../../server/guard";
import { declaredLength } from "../../../../../../server/animation/http";
import { removeBackgroundReference, uploadBackgroundReference } from "../../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../../server/animation/access";

type Context = { params: Promise<{ id: string }> };

/** A picture of a place to inspire the next generated background (raw image body). No AI call. */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    await requireFlipbookAccess(request, id);
    const flipbook = await uploadBackgroundReference(id, request.body, declaredLength(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    await requireFlipbookAccess(request, id);
    return Response.json(await removeBackgroundReference(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
