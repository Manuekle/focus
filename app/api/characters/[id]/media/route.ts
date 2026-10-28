import { errorResponse, AppError } from "../../../../../server/errors";
import { serveFile } from "../../../../../server/serve-file";
import { characterUser } from "../../../../../server/characters/http";
import { characterAsset, readCharacter } from "../../../../../server/characters/store";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    const character = await readCharacter((await params).id, user.id);
    const query = new URL(request.url).searchParams;
    const version = character.versions.find((entry) => entry.id === query.get("version"));
    const reference = character.references.find((entry) => entry.id === query.get("reference"));
    const asset = version ?? reference;
    if (!asset) throw new AppError("media_not_found", 404, "This image doesn’t exist.");
    const response = await serveFile(request, characterAsset(character.id, asset.id), "image/png", query.get("download") === "1" ? `${character.name}-${asset.name}.png` : undefined);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) { return errorResponse(error); }
}
