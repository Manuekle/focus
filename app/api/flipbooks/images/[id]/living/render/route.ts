import { LivingRequestSchema } from "../../../../../../../shared/living";
import { AppError, errorResponse } from "../../../../../../../server/errors";
import { guardRender, readJsonBody } from "../../../../../../../server/guard";
import { renderLiving } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** Renders the picture in motion as the request says. Local work only; the same request reuses its files. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const parsed = LivingRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_living", 400, "Those animation settings aren’t valid.");
    const render = await renderLiving(id, parsed.data, request.signal, () => guardRender(request));
    return Response.json({ render }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
