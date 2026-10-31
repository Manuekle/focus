import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import {
  CharacterAssetIdSchema,
  CharacterIdSchema,
  CharacterSchema,
  NO_BODY,
  characterCover,
  type Character,
  type CharacterPreset,
  type CharacterSummary,
} from "../../shared/characters";
import { AppError } from "../errors";
import { dataRoot } from "../storage";
import { newVersionId, writeAtomic } from "../animation/store";
import { decodeImage } from "../animation/image-input";

type Runtime = {
  locks: Map<string, Promise<unknown>>;
  running: Map<string, AbortController>;
};
const shared = ((
  globalThis as { __focusCharacters?: Runtime }
).__focusCharacters ??= { locks: new Map(), running: new Map() });
export const characterRuntime = shared;
export const activeCharacterCount = () => shared.running.size;
export const charactersRoot = () => path.join(dataRoot(), "characters");
function checkedId(id: string) {
  const parsed = CharacterIdSchema.safeParse(id);
  if (!parsed.success)
    throw new AppError(
      "character_not_found",
      404,
      "This character doesn’t exist.",
    );
  return parsed.data;
}
export const characterDir = (id: string) =>
  path.join(charactersRoot(), checkedId(id));
export function characterAsset(id: string, asset: string) {
  const parsed = CharacterAssetIdSchema.safeParse(asset);
  if (!parsed.success)
    throw new AppError("media_not_found", 404, "This image doesn’t exist.");
  return path.join(characterDir(id), `${parsed.data}.png`);
}
export async function readCharacter(
  id: string,
  ownerId: string,
): Promise<Character> {
  const raw = await readFile(
    path.join(characterDir(id), "character.json"),
    "utf8",
  ).catch(() => null);
  const parsed = raw ? CharacterSchema.safeParse(JSON.parse(raw)) : null;
  if (!parsed?.success || parsed.data.ownerId !== ownerId)
    throw new AppError(
      "character_not_found",
      404,
      "This character doesn’t exist.",
    );
  return parsed.data;
}
export async function writeCharacter(character: Character): Promise<Character> {
  const next = CharacterSchema.parse({
    ...character,
    updatedAt: new Date().toISOString(),
  });
  await writeAtomic(
    path.join(characterDir(next.id), "character.json"),
    JSON.stringify(next),
  );
  return next;
}
export function characterLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = shared.locks.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => undefined);
  shared.locks.set(id, settled);
  void settled.finally(() => {
    if (shared.locks.get(id) === settled) shared.locks.delete(id);
  });
  return next;
}
export async function getCharacter(
  id: string,
  ownerId: string,
): Promise<Character> {
  const character = await readCharacter(id, ownerId);
  if (character.status !== "generating" || shared.running.has(id))
    return character;
  return characterLock(id, async () => {
    const latest = await readCharacter(id, ownerId);
    if (latest.status !== "generating" || shared.running.has(id)) return latest;
    return writeCharacter({
      ...latest,
      status: "failed",
      error: {
        code: "interrupted",
        message:
          "Generation was interrupted. Your previous images are saved. Try the change again.",
      },
    });
  });
}
export async function listCharacters(
  ownerId: string,
): Promise<CharacterSummary[]> {
  const names = await readdir(charactersRoot()).catch(() => [] as string[]);
  const records = await Promise.all(
    names
      .filter((name) => CharacterIdSchema.safeParse(name).success)
      .map((id) => getCharacter(id, ownerId).catch(() => null)),
  );
  return records
    .filter((entry): entry is Character => Boolean(entry))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      preset: entry.preset,
      status: entry.status,
      selectedVersionId: entry.selectedVersionId,
      updatedAt: entry.updatedAt,
      measures: entry.measures,
      versions: entry.versions.length,
      coverUrl: characterCover(entry),
    }));
}
export async function createCharacter(
  ownerId: string,
  input: { name: string; png: Buffer; fileName: string; preset?: CharacterPreset },
): Promise<Character> {
  const decoded = await decodeImage(input.png);
  const id = randomUUID(),
    asset = newVersionId();
  const now = new Date().toISOString();
  await mkdir(characterDir(id), { recursive: true });
  try {
    await writeAtomic(characterAsset(id, asset), decoded.png);
    const rawLimit = Number(process.env.FOCUS_CHARACTER_IMAGE_BUDGET ?? 16);
    return await writeCharacter({
      id,
      ownerId,
      name: input.name,
      preset: input.preset ?? null,
      references: [
        {
          id: asset,
          name: input.fileName.slice(0, 100) || "Original reference",
          role: "identity",
          width: decoded.width,
          height: decoded.height,
        },
      ],
      versions: [],
      selectedVersionId: null,
      status: "ready",
      measures: NO_BODY,
      job: null,
      error: null,
      budget: {
        used: 0,
        limit:
          Number.isInteger(rawLimit) && rawLimit > 0
            ? Math.min(rawLimit, 100)
            : 16,
      },
      operations: [],
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    await rm(characterDir(id), { recursive: true, force: true });
    throw error;
  }
}
