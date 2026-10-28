import { UpdateCharacterSchema } from "../../../../shared/characters";
import { AppError, errorResponse } from "../../../../server/errors";
import { readJsonBody } from "../../../../server/guard";
import { characterUser, privateJson } from "../../../../server/characters/http";
import { getCharacter } from "../../../../server/characters/store";
import { deleteCharacter, updateCharacter } from "../../../../server/characters/characters";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try { const user = await characterUser(request); return privateJson(await getCharacter((await params).id, user.id)); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    const parsed = UpdateCharacterSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_character", 400, "Enter a name or choose a saved version.");
    return privateJson(await updateCharacter((await params).id, user.id, parsed.data));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    await deleteCharacter((await params).id, user.id);
    return privateJson({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
