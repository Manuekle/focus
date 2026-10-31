import { CharacterAssetIdSchema, KIT_IMAGES, type KitImage } from "../../../../../../shared/characters";
import { errorResponse, AppError } from "../../../../../../server/errors";
import { serveFile } from "../../../../../../server/serve-file";
import { characterUser } from "../../../../../../server/characters/http";
import { characterKitImage } from "../../../../../../server/characters/kit";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    const query = new URL(request.url).searchParams;
    const version = CharacterAssetIdSchema.safeParse(query.get("version"));
    const image = query.get("image");
    if (!version.success || !KIT_IMAGES.includes(image as KitImage)) throw new AppError("media_not_found", 404, "This image doesn’t exist.");
    const response = await serveFile(request, await characterKitImage((await params).id, user.id, version.data, image as KitImage), "image/png");
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) { return errorResponse(error); }
}
