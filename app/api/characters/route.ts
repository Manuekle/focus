import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { AppError, errorResponse } from "../../../server/errors";
import { guardUpload, readJsonBody } from "../../../server/guard";
import { declaredLength } from "../../../server/animation/http";
import { readUpload } from "../../../server/animation/image-input";
import { createCharacter, listCharacters } from "../../../server/characters/store";
import { characterUser, privateJson, uploadName } from "../../../server/characters/http";
import { CHARACTER_PRESETS, CharacterPresetSchema } from "../../../shared/characters";

export async function GET(request: Request) {
  try { const user = await characterUser(request); return privateJson(await listCharacters(user.id)); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await characterUser(request);
    await guardUpload(request);
    if (request.headers.get("content-type")?.includes("application/json")) {
      const parsed = z.object({ preset: CharacterPresetSchema, name: z.string().trim().min(1).max(80).optional() }).strict().safeParse(await readJsonBody(request));
      if (!parsed.success) throw new AppError("invalid_character", 400, "Choose a reference and a character name.");
      const preset = CHARACTER_PRESETS[parsed.data.preset];
      const png = await readFile(path.join(process.cwd(), "public", "characters", preset.fileName));
      return privateJson(await createCharacter(user.id, { name: parsed.data.name ?? preset.name, png, fileName: preset.fileName, preset: parsed.data.preset }), 201);
    }
    const name = uploadName(request);
    return privateJson(await createCharacter(user.id, { name: name.replace(/\.[^.]+$/, "").slice(0, 80) || "My character", png: await readUpload(request.body, declaredLength(request)), fileName: name }), 201);
  } catch (error) { return errorResponse(error); }
}
