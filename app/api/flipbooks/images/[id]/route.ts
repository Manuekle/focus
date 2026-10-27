import { errorResponse } from "../../../../../server/errors";
import { serveFile } from "../../../../../server/serve-file";
import { getCharacterImage } from "../../../../../server/animation/image-input";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const { png } = await getCharacterImage(id);
    return await serveFile(request, png, "image/png");
  } catch (error) {
    return errorResponse(error);
  }
}
