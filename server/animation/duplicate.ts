import { randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CharacterSourceSchema } from "../../shared/characters";
import { FlipbookImageIdSchema, type Flipbook } from "../../shared/flipbook";
import { animationCharacterSource } from "../characters/flipbook-source";
import { getCharacterImage } from "./image-input";
import { createState, flipbookDir, flipbookFiles, newVersionId, writeAtomic } from "./store";
import { services, imageBudget } from "./flipbooks";
import { AppError } from "../errors";

export const DuplicateTargetSchema = z.object({ imageId: FlipbookImageIdSchema.optional(), characterSource: CharacterSourceSchema.optional() }).refine((value) => Boolean(value.imageId) !== Boolean(value.characterSource), "Choose an uploaded illustration or a saved character version.");
export type DuplicateTarget = z.infer<typeof DuplicateTargetSchema>;

export async function duplicateFlipbook(source: Flipbook, target: DuplicateTarget, ownerId: string | null): Promise<Flipbook> {
  if (!source.plan || source.cast.length) throw new AppError("duplicate_not_ready", 409, "Prepare a single character's motion before duplicating it.");
  const parsed = DuplicateTargetSchema.parse(target);
  const saved = parsed.characterSource ? await animationCharacterSource(parsed.characterSource, ownerId) : null;
  const uploaded = saved ? null : await getCharacterImage(parsed.imageId!);
  const image = saved?.image ?? uploaded!.image;
  const png = saved?.png ?? await readFile(uploaded!.png);
  const flat = saved?.flat ?? await readFile(uploaded!.flat);
  const id = randomUUID();
  const version = newVersionId();
  const now = new Date().toISOString();
  await mkdir(flipbookDir(id), { recursive: true });
  try {
    // Re-read the new identity; no source character analysis or generated pixels are inherited.
    const analysis = await services.analyze({ imagePng: flat, prompt: "Describe this character's identity only; the existing motion will be reused.", flipbookId: id });
    await writeAtomic(flipbookFiles.source(id), png);
    await writeAtomic(flipbookFiles.sourceFlat(id), flat);
    await writeAtomic(flipbookFiles.reference(id, version), flat);
    if (saved) await writeAtomic(flipbookFiles.identity(id), saved.identity);
    const frames = source.frames.map((frame) => ({ ...frame, status: "pending" as const, approved: false, version: null, originalVersion: null, versions: [], metrics: null, warnings: [], review: null, error: null }));
    // Reusable media belongs to the copy, so source deletion cannot break it.
    const sourceDir = flipbookDir(source.id);
    for (const folder of ["audio", "motion"]) {
      await cp(path.join(/*turbopackIgnore: true*/ sourceDir, folder), path.join(/*turbopackIgnore: true*/ flipbookDir(id), folder), { recursive: true }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
    for (const which of ["scene", "custom", "bg-reference", "generated", "scene-loop", "generated-loop", "scene-far", "scene-near", "generated-far", "generated-near"] as const) {
      const from = flipbookFiles.background(source.id, which);
      const to = flipbookFiles.background(id, which);
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
    return await createState({ ...source, id, imageId: image.id, ownerId, title: `${source.title.slice(0, 45)} · ${image.originalName.slice(0, 30)}`, characterSource: saved?.origin, source: { width: image.width, height: image.height, hasAlpha: image.hasAlpha }, analysis, frames, alignment: null, reference: { kind: "original", version, reason: "New character reference; the original motion is preserved.", createdAt: now }, extraReferences: [], inbetweens: [], revisions: [], budget: { limit: imageBudget(), used: 0 }, review: null, exports: [], error: null, status: "reference_ready", detail: `Copy ready. Generate ${frames.length} drawings for this character.`, progress: null, createdAt: now, updatedAt: now });
  } catch (error) { await rm(flipbookDir(id), { recursive: true, force: true }); throw error; }
}
