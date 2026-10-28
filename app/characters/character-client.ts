"use client";

import { z } from "zod";
import {
  CharacterSchema,
  CharacterSummarySchema,
  type GenerateCharacterRequest,
  type UpdateCharacterSchema,
} from "../../shared/characters";

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
  const response = await fetch(url, { ...init, cache: "no-store" }).catch(
    () => {
      throw new CharacterApiError(
        "The connection was lost. Your saved versions are safe. Try again.",
        "network",
      );
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new CharacterApiError(
      body?.error?.message ?? "This change couldn’t be saved. Try again.",
      body?.error?.code ?? `http_${response.status}`,
    );
  return parse(body);
}
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
    call("/api/characters", {}, (value) =>
      z.array(CharacterSummarySchema).parse(value),
    ),
  get: (id: string) =>
    call(`/api/characters/${id}`, {}, (value) => CharacterSchema.parse(value)),
  elf: () =>
    call("/api/characters", json({ preset: "elf-chan" }), (value) =>
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
    call(`/api/characters/${id}/generate`, json(request), (value) =>
      CharacterSchema.parse(value),
    ),
};
