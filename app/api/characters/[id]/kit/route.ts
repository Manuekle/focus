import { CharacterAssetIdSchema } from "../../../../../shared/characters";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardAiRequest } from "../../../../../server/guard";
import { characterUser, privateJson } from "../../../../../server/characters/http";
import { getCharacterKit, prepareCharacterKit } from "../../../../../server/characters/kit";
type Context = { params: Promise<{ id: string }> };
function versionOf(request: Request) {
  const parsed = CharacterAssetIdSchema.safeParse(new URL(request.url).searchParams.get("version"));
  if (!parsed.success) throw new AppError("version_not_found", 404, "This character version doesn’t exist.");
  return parsed.data;
}
/** A version's animation data: what is prepared, and with which height and weight. */
export async function GET(request: Request, { params }: Context) {
  try { const user = await characterUser(request); return privateJson(await getCharacterKit((await params).id, user.id, versionOf(request))); }
  catch (error) { return errorResponse(error); }
}
/** Prepares it in the background: one Muse Image drawing (the pose sheet) and a few Muse Spark readings. */
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    return privateJson(await prepareCharacterKit((await params).id, user.id, versionOf(request), (cost) => guardAiRequest(request, cost, { models: ["planner", "image"] })), 202);
  } catch (error) { return errorResponse(error); }
}
