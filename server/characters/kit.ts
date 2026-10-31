import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CharacterBodySchema,
  CharacterIdSchema,
  type CharacterBody,
  type CharacterKit,
  type KitImage,
} from "../../shared/characters";
import { AppError } from "../errors";
import { readMetaConfig } from "../ai/meta";
import { activeWorkCount, type PaidWorkGate } from "../jobs";
import { readJsonFile, writeAtomic } from "../animation/store";
import { buildText, type BuildProfile } from "../rotoscope/draw";
import { paletteText, type Palette } from "../rotoscope/colour";
import { characterSheet, finishKit, KIT_FILES, poseToolAvailable, prepareKit } from "../rotoscope/pipeline";
import { sha256 } from "../rotoscope/provenance";
import {
  characterAsset,
  characterDir,
  characterLock,
  characterRuntime,
  charactersRoot,
  getCharacter,
  readCharacter,
  writeCharacter,
} from "./store";

// A version's kit: what its sheet alone decides for animation (pose, description, pose sheet, palette, build),
// prepared once under the character as kits/<version>/ and copied into every rotoscope run drawn from that sheet.
// kits/<version>.json says how far it got; the files are swapped in whole when a preparation finishes.

const KitRecordSchema = z.object({
  status: z.enum(["preparing", "ready", "failed"]),
  /** The sheet's hash as runs keep it (characterSheet): a run of the same pixels finds the kit by it. */
  sha256: z.string().nullable(),
  measures: CharacterBodySchema,
  error: z.string().nullable(),
  preparedAt: z.iso.datetime().nullable(),
});
type KitRecord = z.infer<typeof KitRecordSchema>;

const kitDir = (id: string, versionId: string) => path.join(characterDir(id), "kits", versionId);
const recordFile = (id: string, versionId: string) => `${kitDir(id, versionId)}.json`;
const runningKey = (id: string, versionId: string) => `kit:${id}:${versionId}`;
const readRecord = (id: string, versionId: string) => readJsonFile(recordFile(id, versionId), (value) => KitRecordSchema.parse(value));
const sameBody = (a: CharacterBody, b: CharacterBody) => a.heightCm === b.heightCm && a.weightKg === b.weightKg;

async function owned(id: string, ownerId: string, versionId: string) {
  const character = await getCharacter(id, ownerId);
  if (!character.versions.some((entry) => entry.id === versionId))
    throw new AppError("version_not_found", 404, "This character version doesn’t exist.");
  return character;
}

/** A version's kit as the editor shows it; a preparation this process isn't running was interrupted. */
export async function getCharacterKit(id: string, ownerId: string, versionId: string): Promise<CharacterKit> {
  await owned(id, ownerId, versionId);
  const record = await readRecord(id, versionId);
  const empty: CharacterKit = { versionId, status: "none", error: null, measures: null, preparedAt: null, description: null, build: null, palette: null, style: null, poseSheet: false };
  if (!record) return empty;
  const interrupted = record.status === "preparing" && !characterRuntime.running.has(runningKey(id, versionId));
  const status = interrupted ? "failed" : record.status;
  const error = interrupted ? "Preparing was interrupted. Prepare it again." : record.error;
  if (status !== "ready") return { ...empty, status, error };
  const dir = kitDir(id, versionId);
  const text = (name: string) => readFile(path.join(dir, name), "utf8").catch(() => null);
  const [description, build, palette, style] = await Promise.all([text("character.txt"), text("build.json"), text("palette.json"), text("style.txt")]);
  return {
    versionId,
    status,
    error: null,
    measures: record.measures,
    preparedAt: record.preparedAt,
    description: description?.trim() || null,
    build: build ? buildText(JSON.parse(build) as BuildProfile) : null,
    palette: palette ? paletteText(JSON.parse(palette) as Palette) : null,
    style: style?.trim() || null,
    poseSheet: existsSync(path.join(dir, "pose-sheet.png")),
  };
}

/** A kit picture (the pose sheet or the named palette) of a ready kit. */
export async function characterKitImage(id: string, ownerId: string, versionId: string, image: KitImage): Promise<string> {
  await owned(id, ownerId, versionId);
  const file = path.join(kitDir(id, versionId), image === "pose-sheet" ? "pose-sheet.png" : "palette.png");
  if ((await readRecord(id, versionId))?.status !== "ready" || !existsSync(file))
    throw new AppError("media_not_found", 404, "This image doesn’t exist.");
  return file;
}

/**
 * Prepares a version's kit in the background with the character's current height and weight: one Muse Image
 * drawing (the pose sheet) and a few Muse Spark readings. A kit already being prepared is returned as it is.
 */
export async function prepareCharacterKit(id: string, ownerId: string, versionId: string, gate?: PaidWorkGate): Promise<CharacterKit> {
  const character = await owned(id, ownerId, versionId);
  const key = runningKey(id, versionId);
  if (characterRuntime.running.has(key)) return getCharacterKit(id, ownerId, versionId);
  if (!poseToolAvailable())
    throw new AppError("pose_unavailable", 503, "Pose detection (DWPose) isn’t installed on this server, so character data can’t be prepared here.");
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 0 });
  const controller = new AbortController();
  characterRuntime.running.set(key, controller);
  const measures = character.measures;
  try {
    await writeAtomic(recordFile(id, versionId), JSON.stringify({ status: "preparing", sha256: null, measures, error: null, preparedAt: null } satisfies KitRecord));
  } catch (error) {
    characterRuntime.running.delete(key);
    throw error;
  }
  void build(id, versionId, measures, controller.signal).finally(() => {
    if (characterRuntime.running.get(key) === controller) characterRuntime.running.delete(key);
  });
  return getCharacterKit(id, ownerId, versionId);
}

/**
 * A new version's kit, prepared as soon as it is drawn: it rides on the version's own generation, so no gate of
 * its own. Skipped where it can't be made (no pose tool or model key); the editor can still prepare it later.
 */
export async function autoPrepareCharacterKit(id: string, ownerId: string, versionId: string): Promise<void> {
  if (!poseToolAvailable() || readMetaConfig() === null) return;
  await prepareCharacterKit(id, ownerId, versionId).catch(() => undefined);
}

async function build(id: string, versionId: string, measures: CharacterBody, signal: AbortSignal): Promise<void> {
  const dir = kitDir(id, versionId);
  const scratch = `${dir}.${randomUUID().slice(0, 8)}.tmp`;
  // Deleted meanwhile (the character or the version): nothing is written back.
  const gone = () => signal.aborted || !existsSync(path.join(characterDir(id), "character.json")) || !existsSync(characterAsset(id, versionId));
  try {
    const sheet = await characterSheet(await readFile(characterAsset(id, versionId)));
    await prepareKit(scratch, sheet, measures, () => undefined, signal);
    if (gone()) return;
    await rm(dir, { recursive: true, force: true });
    await rename(scratch, dir);
    await writeAtomic(recordFile(id, versionId), JSON.stringify({ status: "ready", sha256: sha256(sheet), measures, error: null, preparedAt: new Date().toISOString() } satisfies KitRecord));
  } catch (error) {
    if (gone()) return;
    const message = error instanceof Error ? error.message.slice(0, 200) : "Preparing failed.";
    await writeAtomic(recordFile(id, versionId), JSON.stringify({ status: "failed", sha256: null, measures, error: `Couldn’t prepare the character data: ${message}`, preparedAt: null } satisfies KitRecord)).catch(() => undefined);
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Stops a version's kit and removes it (the version is being deleted). */
export async function removeCharacterKit(id: string, versionId: string): Promise<void> {
  characterRuntime.running.get(runningKey(id, versionId))?.abort();
  await rm(kitDir(id, versionId), { recursive: true, force: true });
  await rm(recordFile(id, versionId), { force: true });
}

/** Stops every kit a character is preparing (the character is being deleted). */
export function stopCharacterKits(id: string): void {
  for (const [key, controller] of characterRuntime.running) if (key.startsWith(`kit:${id}:`)) controller.abort();
}

/**
 * The ready kit of one of the owner's character versions whose sheet is these very pixels (a run's character.png),
 * with the height and weight it was prepared with; null when there is none.
 */
export async function findCharacterKit(ownerId: string, sheetSha256: string): Promise<{ readonly dir: string; readonly measures: CharacterBody } | null> {
  const names = await readdir(charactersRoot()).catch(() => [] as string[]);
  for (const name of names) {
    if (!CharacterIdSchema.safeParse(name).success) continue;
    const character = await readCharacter(name, ownerId).catch(() => null);
    if (!character) continue;
    for (const version of character.versions) {
      const record = await readRecord(character.id, version.id);
      if (record?.status === "ready" && record.sha256 === sheetSha256) return { dir: kitDir(character.id, version.id), measures: record.measures };
    }
  }
  return null;
}

/**
 * A rotoscope run prepared a saved version's sheet that has no kit: its own analysis (pose, description, pose sheet)
 * becomes the version's kit, with the palette and build made now instead of at the run's first generate. Never over a
 * kit My characters prepared or is preparing. A character with no height and weight takes the run's. Returns whether
 * the kit was saved.
 */
export async function fillCharacterKitFromRun(ownerId: string, run: string, body: CharacterBody, log: (line: string) => void = () => undefined): Promise<boolean> {
  const sheet = await readFile(path.join(run, "character.png"));
  const hash = sha256(sheet);
  const match = await versionOfSheet(ownerId, hash);
  if (!match) return false;
  const { id, versionId } = match;
  const busy = async () => {
    const record = await readRecord(id, versionId);
    return record?.status === "ready" || characterRuntime.running.has(runningKey(id, versionId));
  };
  if (await busy()) return false;
  log("saving the character’s analysis to My characters (palette and build measured now)…");
  await finishKit(run, log);
  const dir = kitDir(id, versionId);
  const scratch = `${dir}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await mkdir(scratch, { recursive: true });
    await cp(path.join(run, "character.png"), path.join(scratch, "character.png"));
    for (const name of KIT_FILES) if (existsSync(path.join(run, name))) await cp(path.join(run, name), path.join(scratch, name));
    // My characters may have started one meanwhile: theirs wins.
    if (await busy() || !existsSync(characterAsset(id, versionId))) return false;
    await rm(dir, { recursive: true, force: true });
    await rename(scratch, dir);
    await writeAtomic(recordFile(id, versionId), JSON.stringify({ status: "ready", sha256: hash, measures: body, error: null, preparedAt: new Date().toISOString() } satisfies KitRecord));
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
  if (body.heightCm !== null || body.weightKg !== null)
    await characterLock(id, async () => {
      const latest = await readCharacter(id, ownerId);
      if (latest.measures.heightCm === null && latest.measures.weightKg === null) await writeCharacter({ ...latest, measures: body });
    });
  return true;
}

/** The owner's character version whose sheet (as characterSheet keeps it) is these pixels; null when none is. */
async function versionOfSheet(ownerId: string, hash: string): Promise<{ readonly id: string; readonly versionId: string } | null> {
  const names = await readdir(charactersRoot()).catch(() => [] as string[]);
  for (const name of names) {
    if (!CharacterIdSchema.safeParse(name).success) continue;
    const character = await readCharacter(name, ownerId).catch(() => null);
    for (const version of character?.versions ?? []) {
      const png = await readFile(characterAsset(name, version.id)).catch(() => null);
      if (png && sha256(await characterSheet(png).catch(() => Buffer.alloc(0))) === hash) return { id: name, versionId: version.id };
    }
  }
  return null;
}

/** Whether a kit's height and weight are the ones a run is made with: then its description and pose sheet fit it too. */
export const kitFitsBody = (kit: { readonly measures: CharacterBody }, body: CharacterBody) => sameBody(kit.measures, body);
