"use client";

import { z } from "zod";
import {
  CharacterSchema,
  CharacterSummarySchema,
  characterUrls,
  type GenerateCharacterRequest,
  type Character,
  type CharacterPreset,
  type CharacterSummary,
  type UpdateCharacterSchema,
} from "../../shared/characters";
import { characterActivity, discoverCharacters, observeCharacter } from "../_activity/activity-adapters";
import { getActivityVersion, trackActivity } from "../_activity/activity-store";
import { generationFeedback } from "../_auth/generation-feedback";

export class CharacterApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
async function call<T>(
  url: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  const activityVersion = getActivityVersion();
  const response = await fetch(url, { ...init, cache: "no-store" }).catch(
    () => {
      throw new CharacterApiError(
        "The connection was lost. Your saved versions are safe. Try again.",
        "network",
      );
    },
  );
  const body = await response.json().catch(() => null);
  generationFeedback(response, body, init.method);
  if (!response.ok)
    throw new CharacterApiError(
      body?.error?.message ?? "This change couldn’t be saved. Try again.",
      body?.error?.code ?? `http_${response.status}`,
    );
  const value = parse(body);
  if (parse === parseCharacter && activityVersion === getActivityVersion()) observeCharacter(value as Character);
  if (parse === parseCharacterList && activityVersion === getActivityVersion()) discoverCharacters(value as CharacterSummary[]);
  return value;
}
const parseCharacter = (value: unknown) => CharacterSchema.parse(value);
const parseCharacterList = (value: unknown) => z.array(CharacterSummarySchema).parse(value);
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const upload = (file: File): RequestInit => ({
  method: "POST",
  headers: {
    "Content-Type": file.type || "application/octet-stream",
    "X-Focus-Filename": encodeURIComponent(file.name),
  },
  body: file,
});
export const characterApi = {
  list: () =>
    call("/api/characters", {}, parseCharacterList),
  get: (id: string) =>
    call(`/api/characters/${id}`, {}, parseCharacter),
  preset: (preset: CharacterPreset) =>
    call("/api/characters", json({ preset }), (value) =>
      CharacterSchema.parse(value),
    ),
  create: (file: File) =>
    call("/api/characters", upload(file), (value) =>
      CharacterSchema.parse(value),
    ),
  reference: (id: string, file: File, role: "outfit" | "style") =>
    call(
      `/api/characters/${id}/references?role=${role}`,
      upload(file),
      (value) => CharacterSchema.parse(value),
    ),
  update: (id: string, change: z.infer<typeof UpdateCharacterSchema>) =>
    call(`/api/characters/${id}`, json(change, "PATCH"), (value) =>
      CharacterSchema.parse(value),
    ),
  remove: (id: string) =>
    call(`/api/characters/${id}`, { method: "DELETE" }, () => undefined),
  generate: (id: string, request: GenerateCharacterRequest) =>
    trackActivity({ title: "Generating image", href: `/characters?c=${id}`, resource: { kind: "character", id } }, () => call(`/api/characters/${id}/generate`, json(request), parseCharacter), characterActivity),
};

/**
 * Hands a character to another way of animating (Rotoscope, Motion): the
 * page is opened with the saved version, or with an image already uploaded
 * to Focus, and loads it as its own upload.
 */
export function handoffUrl(path: "/rotoscope" | "/animate", from: { characterId: string; versionId: string } | { imageUrl: string } | null): string {
  if (!from) return path;
  return "characterId" in from
    ? `${path}?character=${encodeURIComponent(from.characterId)}&version=${encodeURIComponent(from.versionId)}`
    : `${path}?image=${encodeURIComponent(from.imageUrl)}`;
}

/** Only Focus's own media routes may be fetched as a handed-off character. */
export function handoffImageUrl(params: { character?: string | null; version?: string | null; image?: string | null }): string | null {
  if (params.character && params.version && /^[\w-]{1,64}$/.test(params.character) && /^[\w-]{1,64}$/.test(params.version)) return characterUrls.version(params.character, params.version);
  if (params.image && /^\/api\/[\w/?=&.%-]+$/.test(params.image) && !params.image.includes("..")) return params.image;
  return null;
}

/** A saved character's version (or a handed-off image) as a File, for forms that upload one. */
export async function characterFile(url: string, name: string): Promise<File> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("This character’s image couldn’t be loaded.");
  const blob = await response.blob();
  return new File([blob], `${name.replace(/[^\w.-]+/g, "_") || "character"}.png`, { type: blob.type || "image/png" });
}
