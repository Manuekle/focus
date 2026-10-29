import { z } from "zod";

export const CharacterPresetSchema = z.enum(["ichika", "seita"]);
export type CharacterPreset = z.infer<typeof CharacterPresetSchema>;
export const CHARACTER_PRESETS = {
  ichika: {
    name: "Ichika",
    label: "Female template",
    fileName: "ichika.png",
    width: 768,
    height: 1536,
    alt: "Ichika, with long blonde hair, golden eyes, a white sleeveless shirt, black ribbon, black shorts and thigh-high socks",
    prompt:
      "Keep Ichika exactly as drawn: long straight blonde hair with bangs, golden eyes, face, white sleeveless button-up shirt, black neck ribbon, black shorts, black thigh-high socks and dark loafers. Preserve her proportions, colors, anime line work, pose and original front-facing view. Show the whole body on a plain background.",
  },
  seita: {
    name: "Seita",
    label: "Male template",
    fileName: "seita.png",
    width: 768,
    height: 1536,
    alt: "Seita, with short black hair, a white rolled-sleeve shirt, loose black tie, dark trousers and red-and-white high-top sneakers",
    prompt:
      "Keep Seita exactly as drawn: short tousled black hair, dark eyes, face, white rolled-sleeve shirt, loose black tie, dark belt and trousers, and red-and-white high-top sneakers. Preserve his proportions, colors, anime line work, pose and original front-facing view. Show the whole body on a plain background.",
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
  preset: z.union([CharacterPresetSchema, z.enum(["elf-chan", "denji", "reze"]).transform(() => null)]).nullable(),
  references: z
    .array(CharacterReferenceSchema)
    .min(1)
    .max(CHARACTER_REFERENCE_MAX),
  versions: z.array(CharacterVersionSchema).max(CHARACTER_VERSION_MAX),
  selectedVersionId: CharacterAssetIdSchema.nullable(),
  status: z.enum(["ready", "generating", "failed"]),
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
]);
export const characterUrls = {
  reference: (id: string, asset: string) =>
    `/api/characters/${id}/media?reference=${asset}`,
  version: (id: string, asset: string, download = false) =>
    `/api/characters/${id}/media?version=${asset}${download ? "&download=1" : ""}`,
};
export function characterCover(character: Character): string {
  return character.selectedVersionId
    ? characterUrls.version(character.id, character.selectedVersionId)
    : characterUrls.reference(character.id, character.references[0].id);
}
