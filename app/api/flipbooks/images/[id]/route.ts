import { errorResponse } from "../../../../../server/errors";
import { serveFile } from "../../../../../server/serve-file";
import { AppError } from "../../../../../server/errors";
import { getCharacterImage, imageFiles } from "../../../../../server/animation/image-input";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const { image, png } = await getCharacterImage(id);
    // ?layer=character|scene: the layers made when the upload was read.
    const layer = new URL(request.url).searchParams.get("layer");
    if (layer !== null && layer !== "character" && layer !== "scene") throw new AppError("invalid_variant", 400, "Unknown layer.");
    return await serveFile(request, layer === null ? png : imageFiles(image.id)[layer], "image/png");
  } catch (error) {
    return errorResponse(error);
  }
}
