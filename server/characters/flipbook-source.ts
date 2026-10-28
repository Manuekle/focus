import { readFile } from "node:fs/promises";
import type { CharacterSource } from "../../shared/characters";
import { characterUrls } from "../../shared/characters";
import { AppError } from "../errors";
import { decodeImage } from "../animation/image-input";
import { characterAsset, readCharacter } from "./store";

export async function animationCharacterSource(
  source: CharacterSource,
  ownerId: string | null | undefined,
) {
  if (!ownerId)
    throw new AppError(
      "login_required",
      401,
      "Sign in to use your saved character.",
    );
  const character = await readCharacter(source.characterId, ownerId);
  const version = character.versions.find(
    (entry) => entry.id === source.versionId,
  );
  if (!version)
    throw new AppError(
      "version_not_found",
      404,
      "This character version doesn’t exist.",
    );
  const decoded = await decodeImage(
    await readFile(characterAsset(character.id, version.id)),
  );
  return {
    image: {
      id: character.id,
      originalName: `${character.name} · ${version.name}`,
      width: decoded.width,
      height: decoded.height,
      hasAlpha: decoded.hasAlpha,
      createdAt: version.createdAt,
      url: characterUrls.version(character.id, version.id),
    },
    png: decoded.png,
    flat: decoded.flat,
    identity: await readFile(
      characterAsset(character.id, character.references[0].id),
    ),
    origin: { ...source, name: character.name, versionName: version.name },
  };
}
