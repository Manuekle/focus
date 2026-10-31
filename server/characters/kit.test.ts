import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Character } from "../../shared/characters";
import { updateCharacter } from "./characters";
import { characterAsset, characterDir, createCharacter, readCharacter, writeCharacter } from "./store";
import { fillCharacterKitFromRun, findCharacterKit, getCharacterKit, kitFitsBody, prepareCharacterKit } from "./kit";
import { characterSheet } from "../rotoscope/pipeline";
import { sha256 } from "../rotoscope/provenance";

// No DWPose or model call: the kit's files are written by a stand-in for prepareKit.
const prepared = vi.hoisted(() => [] as { measures: unknown }[]);
vi.mock("../rotoscope/pipeline", async (importOriginal) => {
  const { mkdir, writeFile: write } = await import("node:fs/promises");
  const { join } = await import("node:path");
  return {
    ...(await importOriginal<typeof import("../rotoscope/pipeline")>()),
    poseToolAvailable: () => true,
    prepareKit: async (dir: string, character: Buffer, measures: unknown) => {
      prepared.push({ measures });
      await mkdir(dir, { recursive: true });
      await write(join(dir, "character.png"), character);
      await write(join(dir, "character.txt"), "Keep the character exactly as drawn.\n");
      await write(join(dir, "pose-sheet.png"), character);
      await write(join(dir, "palette.json"), JSON.stringify({ version: 1, colours: [{ name: "hair", hex: "#111111" }] }));
      await write(join(dir, "palette.png"), character);
    },
    finishKit: async (dir: string) => {
      await write(join(dir, "palette.json"), JSON.stringify({ version: 1, colours: [{ name: "skin", hex: "#eeeeee" }] }));
      await write(join(dir, "palette.png"), Buffer.from("png"));
    },
  };
});

let root: string;
let owner: string;
let character: Character;
let png: Buffer;
const oldData = process.env.FOCUS_DATA_DIR;
const versionId = "v-0000000000aa";

async function ready(id: string, version: string) {
  for (let i = 0; i < 200; i++) {
    const kit = await getCharacterKit(id, owner, version);
    if (kit.status !== "preparing") return kit;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("kit timed out");
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "focus-kit-"));
  process.env.FOCUS_DATA_DIR = root;
  owner = randomUUID();
  png = await sharp({ create: { width: 512, height: 768, channels: 4, background: { r: 200, g: 120, b: 90, alpha: 1 } } }).png().toBuffer();
  const created = await createCharacter(owner, { name: "Shion", png, fileName: "shion.png" });
  await writeFile(characterAsset(created.id, versionId), png);
  character = await writeCharacter({
    ...created,
    versions: [{ id: versionId, name: "Base design", prompt: "", parentId: null, operationId: randomUUID(), width: 512, height: 768, createdAt: new Date().toISOString() }],
    selectedVersionId: versionId,
  });
});

afterAll(async () => {
  if (oldData === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = oldData;
  await rm(root, { recursive: true, force: true });
});

describe("character kits", () => {
  it("keeps the character's height and weight", async () => {
    const next = await updateCharacter(character.id, owner, { action: "measures", heightCm: 160, weightKg: 54 });
    expect(next.measures).toEqual({ heightCm: 160, weightKg: 54 });
    character = next;
  });

  it("prepares a version once with those measures and finds it by the run's sheet", async () => {
    expect((await getCharacterKit(character.id, owner, versionId)).status).toBe("none");
    await prepareCharacterKit(character.id, owner, versionId);
    const kit = await ready(character.id, versionId);
    expect(kit).toMatchObject({ status: "ready", measures: { heightCm: 160, weightKg: 54 }, description: "Keep the character exactly as drawn.", palette: "hair #111111", poseSheet: true });
    expect(prepared.at(-1)?.measures).toEqual({ heightCm: 160, weightKg: 54 });
    // A run of the saved version keeps the same sheet (characterSheet) and so finds the kit.
    const found = await findCharacterKit(owner, sha256(await characterSheet(png)));
    expect(found?.dir).toBe(path.join(characterDir(character.id), "kits", versionId));
    expect(found && kitFitsBody(found, { heightCm: 160, weightKg: 54 })).toBe(true);
    expect(found && kitFitsBody(found, { heightCm: 170, weightKg: 54 })).toBe(false);
    expect(await findCharacterKit(randomUUID(), sha256(await characterSheet(png)))).toBeNull();
    expect(await findCharacterKit(owner, sha256(Buffer.from("someone else")))).toBeNull();
  });

  it("reports a preparation this process isn't running as interrupted", async () => {
    await writeFile(path.join(characterDir(character.id), "kits", `${versionId}.json`), JSON.stringify({ status: "preparing", sha256: null, measures: { heightCm: 160, weightKg: 54 }, error: null, preparedAt: null }));
    expect(await getCharacterKit(character.id, owner, versionId)).toMatchObject({ status: "failed", error: expect.stringContaining("interrupted") });
    await prepareCharacterKit(character.id, owner, versionId);
    expect((await ready(character.id, versionId)).status).toBe("ready");
  });

  it("takes a rotoscope run's analysis only when My characters has none", async () => {
    const other = await createCharacter(owner, { name: "Momo", png, fileName: "momo.png" });
    const version = "v-0000000000bb";
    const sheet = await sharp({ create: { width: 512, height: 768, channels: 4, background: { r: 230, g: 190, b: 190, alpha: 1 } } }).png().toBuffer();
    await writeFile(characterAsset(other.id, version), sheet);
    await writeCharacter({ ...other, versions: [{ id: version, name: "Base design", prompt: "", parentId: null, operationId: randomUUID(), width: 512, height: 768, createdAt: new Date().toISOString() }], selectedVersionId: version });
    const run = path.join(root, "run");
    await mkdir(run, { recursive: true });
    await writeFile(path.join(run, "character.png"), await characterSheet(sheet));
    await writeFile(path.join(run, "character-pose.json"), "{}");
    await writeFile(path.join(run, "character.txt"), "Keep Momo exactly as drawn.\n");
    const before = prepared.length;
    expect(await fillCharacterKitFromRun(owner, run, { heightCm: 158, weightKg: null })).toBe(true);
    expect(prepared.length).toBe(before);
    expect(await getCharacterKit(other.id, owner, version)).toMatchObject({ status: "ready", measures: { heightCm: 158, weightKg: null }, description: "Keep Momo exactly as drawn.", palette: "skin #eeeeee", poseSheet: false });
    // The character had no height or weight: it takes the run's.
    expect((await readCharacter(other.id, owner)).measures).toEqual({ heightCm: 158, weightKg: null });
    // Filled once: a second run never overwrites it.
    await writeFile(path.join(run, "character.txt"), "Something else.\n");
    expect(await fillCharacterKitFromRun(owner, run, { heightCm: 170, weightKg: 60 })).toBe(false);
    expect((await getCharacterKit(other.id, owner, version)).description).toBe("Keep Momo exactly as drawn.");
    // An upload that isn't a saved version is left alone.
    await writeFile(path.join(run, "character.png"), png);
    expect(await fillCharacterKitFromRun(randomUUID(), run, { heightCm: null, weightKg: null })).toBe(false);
  });

  it("goes with its version", async () => {
    await updateCharacter(character.id, owner, { action: "delete_version", versionId });
    expect(await findCharacterKit(owner, sha256(await characterSheet(png)))).toBeNull();
    await expect(getCharacterKit(character.id, owner, versionId)).rejects.toMatchObject({ code: "version_not_found" });
  });
});
