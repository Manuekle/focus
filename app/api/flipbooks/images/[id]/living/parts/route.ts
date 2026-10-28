import { LivingLayerIdSchema, LivingPartRequestSchema } from "../../../../../../../shared/living";
import { AppError, errorResponse } from "../../../../../../../server/errors";
import { readJsonBody } from "../../../../../../../server/guard";
import { addPart, removePart } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** Adds a part picked with a click (a tail SAM didn't find). Local work only. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const parsed = LivingPartRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_living", 400, "Click on the part you want to move.");
    return Response.json({ inventory: await addPart(id, parsed.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Removes a part that was picked by hand (`?layer=`). */
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const layer = LivingLayerIdSchema.safeParse(new URL(request.url).searchParams.get("layer"));
    if (!layer.success) throw new AppError("living_layer_unknown", 404, "That part isn’t there.");
    return Response.json({ inventory: await removePart(id, layer.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
