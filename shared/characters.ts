import { z } from "zod";
import { CharacterMeasuresSchema } from "./rotoscope";

export const CharacterPresetSchema = z.enum(["shion", "tomohito"]);
export type CharacterPreset = z.infer<typeof CharacterPresetSchema>;
export const CHARACTER_PRESETS = {
  shion: {
    name: "Shion",
    label: "Character template",
    fileName: "shion.png",
    width: 1024,
    height: 1536,
    alt: "Shion, with very long straight black hair, brown eyes, a calm expression, a black V-neck sweater over a white collared shirt and red bow, a black pleated skirt, black socks and white-and-blue school shoes",
    prompt:
      "Keep Shion exactly as drawn: very long straight black hair with bangs, brown eyes, calm neutral expression, face, black oversized V-neck sweater, white collared shirt, red bow, black pleated miniskirt, black socks and white-and-blue school shoes. Preserve her proportions, colors, anime line work, pose and original front-facing view. Show the whole body on a plain background.",
  },
  tomohito: {
    name: "Tomohito",
    label: "Character template",
    fileName: "tomohito.png",
    width: 1024,
    height: 1536,
    alt: "Tomohito, with short messy black hair, dark eyes, a calm expression, a black V-neck sweater over a white collared shirt and red tie, black trousers and white-and-blue school shoes",
    prompt:
      "Keep Tomohito exactly as drawn: short messy black hair with a loose fringe, dark eyes, calm neutral expression, face, black oversized V-neck sweater, white collared shirt with the hem showing below the sweater, red tie, straight black trousers and white-and-blue school shoes. Preserve his proportions, colors, anime line work, pose and original front-facing view. Show the whole body on a plain background.",
  },
} as const satisfies Record<CharacterPreset, {
  name: string;
  label: string;
  fileName: string;
  width: number;
  height: number;
  alt: string;
  prompt: string;
}>;

export const CharacterIdSchema = z.uuid();
export const CharacterAssetIdSchema = z.string().regex(/^v-[a-f0-9]{12}$/);
export const CHARACTER_REFERENCE_MAX = 3;
export const CHARACTER_VERSION_MAX = 32;
export const CharacterSourceSchema = z.object({
  characterId: CharacterIdSchema,
  versionId: CharacterAssetIdSchema,
});
export type CharacterSource = z.infer<typeof CharacterSourceSchema>;

export const CharacterReferenceSchema = z.object({
  id: CharacterAssetIdSchema,
  name: z.string().min(1).max(100),
  role: z.enum(["identity", "outfit", "style"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const CharacterVersionSchema = z.object({
  id: CharacterAssetIdSchema,
  name: z.string().trim().min(1).max(60),
  prompt: z.string().max(1200),
  parentId: CharacterAssetIdSchema.nullable(),
  operationId: z.uuid(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type CharacterVersion = z.infer<typeof CharacterVersionSchema>;
/** The character's real height and weight: every animation drawn from it keeps that body. */
export const CharacterBodySchema = CharacterMeasuresSchema.pick({ heightCm: true, weightKg: true });
export type CharacterBody = z.infer<typeof CharacterBodySchema>;
export const NO_BODY: CharacterBody = { heightCm: null, weightKg: null };
export const CharacterJobSchema = z.object({
  operationId: z.uuid(),
  fingerprint: z.string().length(64),
  prompt: z.string().max(1200),
  name: z.string().max(60),
  fromVersionId: CharacterAssetIdSchema.nullable(),
  startedAt: z.iso.datetime(),
});
export const CharacterSchema = z.object({
  id: CharacterIdSchema,
  ownerId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  // Retired templates remain readable without appearing in the starter list.
  preset: z.union([CharacterPresetSchema, z.enum(["elf-chan", "denji", "reze", "ichika", "seita"]).transform(() => null)]).nullable(),
  references: z
    .array(CharacterReferenceSchema)
    .min(1)
    .max(CHARACTER_REFERENCE_MAX),
  versions: z.array(CharacterVersionSchema).max(CHARACTER_VERSION_MAX),
  selectedVersionId: CharacterAssetIdSchema.nullable(),
  status: z.enum(["ready", "generating", "failed"]),
  measures: CharacterBodySchema.default(NO_BODY),
  job: CharacterJobSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  budget: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }),
  operations: z
    .array(z.object({ id: z.uuid(), fingerprint: z.string().length(64) }))
    .max(64),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Character = z.infer<typeof CharacterSchema>;
export const CharacterSummarySchema = CharacterSchema.pick({
  id: true,
  name: true,
  preset: true,
  status: true,
  selectedVersionId: true,
  updatedAt: true,
  measures: true,
}).extend({
  versions: z.number().int().nonnegative(),
  coverUrl: z.string(),
});
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;
export const GenerateCharacterSchema = z
  .object({
    operationId: z.uuid(),
    prompt: z.string().trim().min(3).max(1200),
    name: z.string().trim().min(1).max(60).optional(),
    fromVersionId: CharacterAssetIdSchema.nullable(),
  })
  .strict();
export type GenerateCharacterRequest = z.infer<typeof GenerateCharacterSchema>;
export const UpdateCharacterSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("rename"),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({ action: z.literal("select"), versionId: CharacterAssetIdSchema })
    .strict(),
  z
    .object({
      action: z.literal("rename_version"),
      versionId: CharacterAssetIdSchema,
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete_version"),
      versionId: CharacterAssetIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove_reference"),
      referenceId: CharacterAssetIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("measures"),
      heightCm: CharacterBodySchema.shape.heightCm,
      weightKg: CharacterBodySchema.shape.weightKg,
    })
    .strict(),
]);
/**
 * What a version's sheet alone decides for animation, prepared once and copied into every rotoscope run drawn
 * from it: its pose, description, pose sheet, palette and body measurements (server/characters/kit.ts).
 */
export const CharacterKitSchema = z.object({
  versionId: CharacterAssetIdSchema,
  status: z.enum(["none", "preparing", "ready", "failed"]),
  error: z.string().nullable(),
  /** The height and weight it was prepared with: the description and the pose sheet say them. */
  measures: CharacterBodySchema.nullable(),
  preparedAt: z.iso.datetime().nullable(),
  description: z.string().nullable(),
  /** The body measured on the grid, in heads (rotoscope draw.ts buildText). */
  build: z.string().nullable(),
  /** The palette's named colours (rotoscope colour.ts paletteText). */
  palette: z.string().nullable(),
  /** How the sheet is drawn, one labelled line per part (rotoscope draw.ts describeStyle). */
  style: z.string().nullable().default(null),
  poseSheet: z.boolean(),
});
export type CharacterKit = z.infer<typeof CharacterKitSchema>;
export const KIT_IMAGES = ["pose-sheet", "palette"] as const;
export type KitImage = (typeof KIT_IMAGES)[number];
export const characterUrls = {
  reference: (id: string, asset: string) =>
    `/api/characters/${id}/media?reference=${asset}`,
  version: (id: string, asset: string, download = false) =>
    `/api/characters/${id}/media?version=${asset}${download ? "&download=1" : ""}`,
  kit: (id: string, asset: string) => `/api/characters/${id}/kit?version=${asset}`,
  /** `stamp` (the kit's preparedAt) changes the URL when the kit is prepared again. */
  kitImage: (id: string, asset: string, image: KitImage, stamp: string) =>
    `/api/characters/${id}/kit/media?version=${asset}&image=${image}&v=${encodeURIComponent(stamp)}`,
};
export function characterCover(character: Character): string {
  return character.selectedVersionId
    ? characterUrls.version(character.id, character.selectedVersionId)
    : characterUrls.reference(character.id, character.references[0].id);
}
