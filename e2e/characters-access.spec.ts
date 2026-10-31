import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { imageUploadMb } from "./media-limits";

const DATA = path.join(import.meta.dirname, "..", ".focus-data-e2e");
const SECRET = "focus-e2e-session-key-for-isolated-tests-only";

test("signed-in character uploads enforce origins, file limits and the storage budget while allowing deletion", async ({ request, baseURL }) => {
  const id = randomUUID();
  await mkdir(path.join(DATA, "users"), { recursive: true });
  await writeFile(path.join(DATA, "users", `${id}.json`), JSON.stringify({ id, provider: "facebook", providerId: `test-${id}`, name: "Upload check", avatarUrl: null, email: null, simulated: true, createdAt: new Date().toISOString() }));
  const body = `${id}.${Date.now() + 60_000}`;
  const token = `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
  const headers = { origin: baseURL!, cookie: `focus_session=${token}`, "Content-Type": "image/png", "x-focus-filename": "upload-check.png" };
  const png = await readFile(path.join(import.meta.dirname, "..", "public", "characters", "shion.png"));
  const uploaded = await request.post("/api/characters", { headers, data: png });
  expect(uploaded.status()).toBe(201);
  const character = await uploaded.json();
  expect(character.references).toHaveLength(1);
  expect(uploaded.headers()["cache-control"]).toBe("private, no-store");

  const external = await request.post(`/api/characters/${character.id}/references?role=outfit`, { headers: { ...headers, origin: "https://other.example" }, data: png });
  expect(external.status()).toBe(403);
  expect((await external.json()).error.code).toBe("invalid_origin");

  const reference = await request.post(`/api/characters/${character.id}/references?role=outfit`, { headers, data: png });
  expect(reference.status()).toBe(200);
  expect((await reference.json()).references).toHaveLength(2);

  const oversized = await request.post("/api/characters", { headers, data: Buffer.alloc(imageUploadMb * 1024 * 1024 + 1) });
  expect(oversized.status()).toBe(413);
  expect((await oversized.json()).error.code).toBe("image_too_large");

  const pressureFile = path.join(DATA, `storage-pressure-${id}`);
  try {
    await writeFile(pressureFile, "");
    // A sparse file exercises the real server budget without allocating 350 MB.
    await truncate(pressureFile, 350 * 1024 * 1024);
    const blocked = await request.post("/api/characters", { headers, data: png });
    expect(blocked.status()).toBe(507);
    expect((await blocked.json()).error.code).toBe("storage_full");
    expect((await request.get("/api/health")).ok()).toBe(true);
    expect((await request.delete(`/api/characters/${character.id}`, { headers })).ok()).toBe(true);
  } finally { await rm(pressureFile, { force: true }); }

  const recovered = await request.post("/api/characters", { headers, data: png });
  expect(recovered.status()).toBe(201);
  expect((await request.delete(`/api/characters/${(await recovered.json()).id}`, { headers })).ok()).toBe(true);
});
