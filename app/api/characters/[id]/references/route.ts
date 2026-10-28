import { errorResponse, AppError } from "../../../../../server/errors";
import { guardUpload } from "../../../../../server/guard";
import { declaredLength } from "../../../../../server/animation/http";
import { readUpload } from "../../../../../server/animation/image-input";
import { characterUser, privateJson, uploadName } from "../../../../../server/characters/http";
import { readCharacter } from "../../../../../server/characters/store";
import { addCharacterReference } from "../../../../../server/characters/characters";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    const { id } = await params;
    await readCharacter(id, user.id);
    guardUpload(request);
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "outfit" && role !== "style") throw new AppError("invalid_reference", 400, "Choose Outfit or Style for this reference.");
    return privateJson(await addCharacterReference(id, user.id, { bytes: await readUpload(request.body, declaredLength(request)), name: uploadName(request), role }));
  } catch (error) { return errorResponse(error); }
}
