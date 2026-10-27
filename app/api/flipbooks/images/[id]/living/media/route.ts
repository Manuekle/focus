import path from "node:path";
import { LivingLayerIdSchema } from "../../../../../../../shared/living";
import { AppError, errorResponse } from "../../../../../../../server/errors";
import { serveFile } from "../../../../../../../server/serve-file";
import { livingFiles, readInventory, readLivingRender } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/**
 * Only files the upload's own records name: ?layer=<id> for a layer's mask,
 * ?x=<render key>&name=<file> for a rendered animation (&download=1 to save it).
 */
export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const search = new URL(request.url).searchParams;
    const files = livingFiles(id);
    const layer = search.get("layer");
    if (layer !== null) {
      const inventory = await readInventory(id);
      if (!LivingLayerIdSchema.safeParse(layer).success || !inventory?.layers.some((entry) => entry.id === layer)) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return await serveFile(request, files.mask(layer), "image/png");
    }
    const render = await readLivingRender(id, search.get("x") ?? "");
    const file = render?.files.find((entry) => entry.name === search.get("name"));
    if (!render || !file) throw new AppError("media_not_found", 404, "This animation is no longer available.");
    return await serveFile(request, path.join(files.renderDir(render.key), file.name), file.type, search.get("download") === "1" ? file.name : undefined);
  } catch (error) {
    return errorResponse(error);
  }
}
