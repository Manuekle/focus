import { GenerateCharacterSchema } from "../../../../../shared/characters";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../../../server/guard";
import { characterUser, privateJson } from "../../../../../server/characters/http";
import { generateCharacterVersion } from "../../../../../server/characters/characters";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await characterUser(request);
    const parsed = GenerateCharacterSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_character_change", 400, "Describe the change in 3 to 1,200 characters.");
    return privateJson(await generateCharacterVersion((await params).id, user.id, parsed.data, (cost) => guardAiRequest(request, cost, { models: ["image"] })), 202);
  } catch (error) { return errorResponse(error); }
}
