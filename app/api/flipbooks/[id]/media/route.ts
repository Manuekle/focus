import { errorResponse } from "../../../../../server/errors";
import { flipbookMedia } from "../../../../../server/animation/http";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    return await flipbookMedia(request, id);
  } catch (error) {
    return errorResponse(error);
  }
}
