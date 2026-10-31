import path from "node:path";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CHARACTER_PRESETS, CharacterPresetSchema, CharacterSchema, type Character } from "../../shared/characters";
import { AppError } from "../errors";
import { activeWorkCount } from "../jobs";
import {
  characterServices,
  addCharacterReference,
  deleteCharacter,
  generateCharacterVersion,
  updateCharacter,
} from "./characters";
import {
  activeCharacterCount,
  characterAsset,
  characterRuntime,
  createCharacter,
  getCharacter,
  listCharacters,
  readCharacter,
  writeCharacter,
} from "./store";
import { animationCharacterSource } from "./flipbook-source";
import { GET as media } from "../../app/api/characters/[id]/media/route";
import {
  GET as detail,
  PATCH as patch,
} from "../../app/api/characters/[id]/route";
import { POST as generate } from "../../app/api/characters/[id]/generate/route";
import { POST as create } from "../../app/api/characters/route";

// Tests have no provider calls and always use the supplied Shion reference.
vi.mock("../auth/users", () => ({
  currentUser: async (request: Request) => {
    const id = request.headers.get("x-test-user");
    return id
      ? { id, name: "Test", provider: "facebook", simulated: true }
      : null;
  },
}));

let root: string;
let shion: Buffer;
let owner: string;
let character: Character;
let calls: Parameters<typeof characterServices.generate>[0][];
const originalGenerate = characterServices.generate;
const originalPrepareKit = characterServices.prepareKit;
let kits: string[];
const oldData = process.env.FOCUS_DATA_DIR;
const oldFlag = process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK;
async function settled(id: string) {
  for (let i = 0; i < 200; i++) {
    const current = await getCharacter(id, owner);
    if (current.status !== "generating" && activeCharacterCount() === 0)
      return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("character job timed out");
}
const request = (
  prompt = "Make a full-body design",
  fromVersionId: string | null = null,
) => ({ operationId: randomUUID(), prompt, fromVersionId });
const http = (id = owner, method = "GET", body?: unknown) =>
  new Request("http://localhost:3200/api/characters", {
    method,
    headers: {
      ...(id ? { "x-test-user": id } : {}),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "focus-characters-"));
  process.env.FOCUS_DATA_DIR = root;
  process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
  shion = await readFile(
    path.join(process.cwd(), "public/characters/shion.png"),
  );
});
beforeEach(async () => {
  owner = randomUUID();
  calls = [];
  kits = [];
  characterServices.generate = async (input) => {
    calls.push(input);
    return { png: shion, width: 768, height: 1536 };
  };
  characterServices.prepareKit = async (_id, _owner, versionId) => {
    kits.push(versionId);
  };
  character = await createCharacter(owner, {
    name: "Shion",
    png: shion,
    fileName: "shion.png",
    preset: "shion",
  });
});
afterAll(async () => {
  characterServices.generate = originalGenerate;
  characterServices.prepareKit = originalPrepareKit;
  if (oldData === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = oldData;
  if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK;
  else process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = oldFlag;
  await rm(root, { recursive: true, force: true });
});

describe("character versions", () => {
  /** A dark figure on flat magenta, as the model is asked to draw. */
  const onMagenta = async () => {
    const figure = await sharp({ create: { width: 120, height: 360, channels: 3, background: { r: 30, g: 40, b: 90 } } }).png().toBuffer();
    return sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 255, g: 0, b: 255 } } })
      .composite([{ input: figure, left: 140, top: 100 }])
      .png()
      .toBuffer();
  };
  const alphaAt = async (png: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return data[(y * info.width + x) * 4 + 3];
  };

  it("asks for a flat magenta background and keeps every version without it", async () => {
    characterServices.generate = async (input) => {
      calls.push(input);
      return { png: await onMagenta(), width: 400, height: 600 };
    };
    await generateCharacterVersion(character.id, owner, request());
    const done = await settled(character.id);
    expect(calls[0].prompt).toContain("#FF00FF");
    const saved = await readFile(characterAsset(done.id, done.selectedVersionId!));
    expect(await alphaAt(saved, 2, 2)).toBe(0);
    expect(await alphaAt(saved, 397, 597)).toBe(0);
    expect(await alphaAt(saved, 200, 300)).toBe(255);
  });

  it("shows a saved transparent version to the model on magenta", async () => {
    characterServices.generate = async (input) => {
      calls.push(input);
      return { png: await onMagenta(), width: 400, height: 600 };
    };
    await generateCharacterVersion(character.id, owner, request());
    const base = await settled(character.id);
    await generateCharacterVersion(base.id, owner, request("Change the coat", base.selectedVersionId));
    await settled(base.id);
    const sent = await sharp(calls[1].references[0].png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([...sent.data.subarray(0, 4)]).toEqual([255, 0, 255, 255]);
    expect(calls[1].prompt).toContain("#FF00FF");
  });

  it("keeps a drawing that came back on another background as drawn", async () => {
    await generateCharacterVersion(character.id, owner, request());
    const done = await settled(character.id);
    const saved = await readFile(characterAsset(done.id, done.selectedVersionId!));
    expect(await alphaAt(saved, 2, 2)).toBe(255);
  });

  it("stores Shion’s immutable original and scopes the library to its owner", async () => {
    expect(character.versions).toHaveLength(0);
    expect(
      (await readFile(characterAsset(character.id, character.references[0].id)))
        .length,
    ).toBeGreaterThan(1000);
    expect((await listCharacters(owner)).map((entry) => entry.id)).toEqual([
      character.id,
    ]);
    expect(await listCharacters(randomUUID())).toEqual([]);
    await expect(
      getCharacter(character.id, randomUUID()),
    ).rejects.toMatchObject({ code: "character_not_found" });
    await expect(getCharacter("../../etc/passwd", owner)).rejects.toMatchObject(
      { code: "character_not_found" },
    );
  });

  it("keeps the original in every generation and separates identity from outfit edits", async () => {
    await generateCharacterVersion(character.id, owner, request());
    const base = await settled(character.id);
    expect(base.versions).toHaveLength(1);
    const identity = await readFile(
      characterAsset(base.id, base.references[0].id),
    );
    expect(calls[0].references[0].png.equals(identity)).toBe(true);
    await generateCharacterVersion(
      base.id,
      owner,
      request("Change the coat to green", base.selectedVersionId),
    );
    const edited = await settled(base.id);
    expect(edited.versions).toHaveLength(2);
    expect(edited.versions[1].parentId).toBe(base.selectedVersionId);
    expect(calls[1].action).toBe("edit");
    expect(calls[1].references[1].png.equals(identity)).toBe(true);
    expect(calls[1].references[1].role).toContain("clothing does NOT override");
    expect(edited.references).toEqual(base.references);
    expect(edited.versions[0]).toEqual(base.versions[0]);
    // Each new design's animation data is prepared as soon as it is saved.
    expect(kits).toEqual(edited.versions.map((entry) => entry.id));
  });

  it("always asks for the base design front-on in a neutral pose, whatever the reference shows", async () => {
    await generateCharacterVersion(character.id, owner, request("Wearing a red scarf"));
    await settled(character.id);
    expect(calls[0].prompt).toContain("FRONT-ON");
    expect(calls[0].prompt).toContain("NEUTRAL pose");
    expect(calls[0].prompt).not.toContain("Preserve the camera angle");
    expect(calls[0].references[0].role).toContain("NOT its pose or camera angle");
  });

  it("selects and names versions without paying for another image", async () => {
    await generateCharacterVersion(character.id, owner, request());
    let current = await settled(character.id);
    await generateCharacterVersion(
      current.id,
      owner,
      request("Try a winter coat", current.selectedVersionId),
    );
    current = await settled(current.id);
    const first = current.versions[0].id;
    const count = calls.length;
    const renamed = await updateCharacter(current.id, owner, {
      action: "rename_version",
      versionId: first,
      name: "Everyday",
    });
    expect(renamed.versions[0].name).toBe("Everyday");
    const selected = await updateCharacter(current.id, owner, {
      action: "select",
      versionId: first,
    });
    expect((await getCharacter(current.id, owner)).selectedVersionId).toBe(
      first,
    );
    expect(selected.versions).toHaveLength(2);
    expect(calls).toHaveLength(count);
  });

  it("deduplicates double submits, counts active work and rejects a reused operation with different content", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    characterServices.generate = async (input) => {
      calls.push(input);
      await wait;
      return { png: shion, width: 768, height: 1536 };
    };
    const change = request();
    const gate = vi.fn(async () => undefined);
    const [a, b] = await Promise.all([
      generateCharacterVersion(character.id, owner, change, gate),
      generateCharacterVersion(character.id, owner, change, gate),
    ]);
    expect(a.status).toBe("generating");
    expect(b.budget.used).toBe(1);
    expect(activeCharacterCount()).toBe(1);
    expect(activeWorkCount()).toBeGreaterThanOrEqual(1);
    expect(gate).toHaveBeenCalledTimes(1);
    await expect(
      generateCharacterVersion(character.id, owner, {
        ...change,
        prompt: "Different prompt",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    await expect(
      generateCharacterVersion(character.id, owner, request("Another change")),
    ).rejects.toMatchObject({ code: "character_busy" });
    release();
    const done = await settled(character.id);
    expect(done.versions).toHaveLength(1);
    await generateCharacterVersion(character.id, owner, change, gate);
    expect(calls).toHaveLength(1);
  });

  it("keeps the last good design and the failed instruction when a model declines an edit", async () => {
    await generateCharacterVersion(character.id, owner, request());
    const base = await settled(character.id);
    characterServices.generate = async () => {
      throw new AppError("image_blocked", 422, "Try another change.");
    };
    await generateCharacterVersion(
      base.id,
      owner,
      request("Change the coat", base.selectedVersionId),
    );
    const failed = await settled(base.id);
    expect(failed.status).toBe("failed");
    expect(failed.selectedVersionId).toBe(base.selectedVersionId);
    expect(failed.versions).toEqual(base.versions);
    expect(failed.job?.prompt).toBe("Change the coat");
    expect(failed.budget.used).toBe(1);
    expect(failed.error?.code).toBe("image_blocked");
  });

  it("enforces the budget before calling a provider", async () => {
    await writeCharacter({ ...character, budget: { used: 2, limit: 2 } });
    await expect(
      generateCharacterVersion(character.id, owner, request()),
    ).rejects.toMatchObject({ code: "character_budget_reached" });
    expect(calls).toHaveLength(0);
  });

  it("recovers an interrupted job without dropping prior versions or its instruction", async () => {
    await generateCharacterVersion(character.id, owner, request());
    const base = await settled(character.id);
    const operationId = randomUUID();
    await writeCharacter({
      ...base,
      status: "generating",
      job: {
        operationId,
        fingerprint: "a".repeat(64),
        prompt: "Make the coat green",
        name: "Green coat",
        fromVersionId: base.selectedVersionId,
        startedAt: new Date().toISOString(),
      },
    });
    expect(characterRuntime.running.has(base.id)).toBe(false);
    const restored = await getCharacter(base.id, owner);
    expect(restored.status).toBe("failed");
    expect(restored.versions).toEqual(base.versions);
    expect(restored.job?.prompt).toBe("Make the coat green");
  });

  it("keeps one reference per role and never replaces the primary reference", async () => {
    const primary = character.references[0];
    await addCharacterReference(character.id, owner, {
      bytes: shion,
      name: "outfit.png",
      role: "outfit",
    });
    const full = await addCharacterReference(character.id, owner, {
      bytes: shion,
      name: "style.png",
      role: "style",
    });
    expect(full.references[0]).toEqual(primary);
    expect(full.references).toHaveLength(3);
    const replaced = await addCharacterReference(character.id, owner, {
      bytes: shion,
      name: "another-style.png",
      role: "style",
    });
    expect(replaced.references.map((entry) => entry.role)).toEqual(["identity", "outfit", "style"]);
    expect(replaced.references[2].name).toBe("another-style.png");
    await expect(access(characterAsset(character.id, full.references[2].id))).rejects.toThrow();
  });

  it("dresses the character in the outfit photo and draws it in the style reference", async () => {
    await addCharacterReference(character.id, owner, { bytes: shion, name: "outfit.jpg", role: "outfit" });
    await addCharacterReference(character.id, owner, { bytes: shion, name: "style.png", role: "style" });
    await generateCharacterVersion(character.id, owner, request());
    let current = await settled(character.id);
    expect(calls[0].prompt).toContain("outfit from Image 2");
    expect(calls[0].prompt).toContain("art style of Image 3");
    expect(calls[0].prompt).not.toContain("EVERY garment exactly as drawn");
    expect(calls[0].references[0].role).toContain("NOT its clothing");
    expect(calls[0].references[1].role).toContain("Take ONLY its clothing");
    expect(calls[0].references[2].role).toContain("Take ONLY how it is drawn");
    await generateCharacterVersion(current.id, owner, request("Make it winter", current.selectedVersionId));
    current = await settled(current.id);
    expect(calls[1].prompt).toContain("outfit from Image 3");
    expect(calls[1].prompt).toContain("art style of Image 4");
    expect(calls[1].references[0].role).toContain("REPLACED by the outfit reference");
    expect(calls[1].references[1].role).not.toContain("illustration style");
  });

  it("asks for the reference outfit exactly on a first design", async () => {
    await generateCharacterVersion(character.id, owner, request());
    await settled(character.id);
    expect(calls[0].prompt).toContain("EVERY garment exactly as drawn");
    expect(calls[0].prompt).not.toContain("dark trousers and ankle boots");
    expect(calls[0].references[0].role).toContain("complete outfit exactly as drawn");
  });

  it("deletes a version, reselects the latest and files its children under the parent", async () => {
    await generateCharacterVersion(character.id, owner, request());
    let current = await settled(character.id);
    await generateCharacterVersion(current.id, owner, request("Winter coat", current.selectedVersionId));
    current = await settled(current.id);
    await generateCharacterVersion(current.id, owner, request("Add a satchel", current.selectedVersionId));
    current = await settled(current.id);
    const [first, second, third] = current.versions.map((entry) => entry.id);
    const next = await updateCharacter(current.id, owner, { action: "delete_version", versionId: second });
    expect(next.versions.map((entry) => entry.id)).toEqual([first, third]);
    expect(next.versions[1].parentId).toBe(first);
    await expect(access(characterAsset(current.id, second))).rejects.toThrow();
    const last = await updateCharacter(current.id, owner, { action: "delete_version", versionId: third });
    expect(last.selectedVersionId).toBe(first);
    await expect(updateCharacter(current.id, owner, { action: "delete_version", versionId: second })).rejects.toMatchObject({ code: "version_not_found" });
  });

  it("removes a supporting reference but never the original", async () => {
    const withOutfit = await addCharacterReference(character.id, owner, { bytes: shion, name: "outfit.png", role: "outfit" });
    const outfit = withOutfit.references[1];
    const removed = await updateCharacter(character.id, owner, { action: "remove_reference", referenceId: outfit.id });
    expect(removed.references).toEqual([character.references[0]]);
    await expect(access(characterAsset(character.id, outfit.id))).rejects.toThrow();
    await expect(updateCharacter(character.id, owner, { action: "remove_reference", referenceId: character.references[0].id })).rejects.toMatchObject({ code: "reference_not_found" });
  });

  it("deletes a character with its images, only for its owner", async () => {
    await generateCharacterVersion(character.id, owner, request());
    await settled(character.id);
    await expect(deleteCharacter(character.id, randomUUID())).rejects.toMatchObject({ code: "character_not_found" });
    await deleteCharacter(character.id, owner);
    await expect(getCharacter(character.id, owner)).rejects.toMatchObject({ code: "character_not_found" });
    expect(await listCharacters(owner)).toEqual([]);
  });

  it("loads exactly the chosen version for Flipbook and retains the immutable Shion reference", async () => {
    await generateCharacterVersion(character.id, owner, request());
    const base = await settled(character.id);
    const source = { characterId: base.id, versionId: base.selectedVersionId! };
    const snapshot = await animationCharacterSource(source, owner);
    const original = await readFile(
      characterAsset(base.id, base.references[0].id),
    );
    expect(snapshot.identity.equals(original)).toBe(true);
    expect(snapshot.origin.versionId).toBe(base.selectedVersionId);
    await expect(
      animationCharacterSource(source, randomUUID()),
    ).rejects.toMatchObject({ code: "character_not_found" });
    await expect(animationCharacterSource(source, null)).rejects.toMatchObject({
      code: "login_required",
    });
    const copy = Buffer.from(snapshot.png);
    await updateCharacter(base.id, owner, {
      action: "rename",
      name: "Shion winter",
    });
    expect(snapshot.origin.name).toBe("Shion");
    expect(snapshot.png.equals(copy)).toBe(true);
  });
});

describe("private character HTTP routes", () => {
  it.each(CharacterPresetSchema.options)("creates the %s template from its supplied reference without generating", async (preset) => {
    const response = await create(http(owner, "POST", { preset }));
    expect(response.status).toBe(201);
    const saved = CharacterSchema.parse(await response.json());
    const template = CHARACTER_PRESETS[preset];
    expect(saved).toMatchObject({
      name: template.name,
      ownerId: owner,
      preset,
      references: [{ name: template.fileName, role: "identity", width: template.width, height: template.height }],
      versions: [],
      budget: { used: 0 },
    });
    expect((await getCharacter(saved.id, owner)).preset).toBe(preset);
    const { decodeImage } = await import("../animation/image-input");
    const original = await decodeImage(await readFile(path.join(process.cwd(), "public/characters", template.fileName)));
    expect((await readFile(characterAsset(saved.id, saved.references[0].id))).equals(original.png)).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it.each(["elf-chan", "denji", "reze", "ichika", "seita"])("rejects the retired %s starter while keeping saved characters readable", async (preset) => {
    const response = await create(http(owner, "POST", { preset }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_character");
    const legacy = CharacterSchema.parse({ ...character, preset });
    expect(legacy.preset).toBeNull();
    expect(legacy.references).toEqual(character.references);
    expect(calls).toHaveLength(0);
  });
  it("requires a session and returns 404 to a different account", async () => {
    const context = { params: Promise.resolve({ id: character.id }) };
    expect((await detail(http(""), context)).status).toBe(401);
    expect((await detail(http(randomUUID()), context)).status).toBe(404);
    expect((await detail(http(), context)).status).toBe(200);
  });
  it("serves only an owner’s named image and disables shared caching", async () => {
    const url = `http://localhost:3200/api/characters/${character.id}/media?reference=${character.references[0].id}`;
    const context = { params: Promise.resolve({ id: character.id }) };
    expect(
      (
        await media(
          new Request(url, { headers: { "x-test-user": randomUUID() } }),
          context,
        )
      ).status,
    ).toBe(404);
    const ok = await media(
      new Request(url, { headers: { "x-test-user": owner } }),
      context,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    await ok.arrayBuffer();
    expect(
      (
        await media(
          new Request(
            `http://localhost:3200/api/characters/${character.id}/media?version=../../secrets`,
            { headers: { "x-test-user": owner } },
          ),
          context,
        )
      ).status,
    ).toBe(404);
  });
  it("blocks cross-origin writes and permits the browser’s host behind an internal URL", async () => {
    const context = { params: Promise.resolve({ id: character.id }) };
    const body = JSON.stringify({ action: "rename", name: "Shion" });
    const headers = {
      "Content-Type": "application/json",
      "x-test-user": owner,
      host: "127.0.0.1:3200",
    };
    expect(
      (
        await patch(
          new Request("http://localhost:3200/api/characters", {
            method: "PATCH",
            headers: { ...headers, origin: "https://other.example" },
            body,
          }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patch(
          new Request("http://localhost:3200/api/characters", {
            method: "PATCH",
            headers: { ...headers, origin: "http://127.0.0.1:3200" },
            body,
          }),
          context,
        )
      ).status,
    ).toBe(200);
  });
  it("rejects unknown generation fields without starting a job", async () => {
    const context = { params: Promise.resolve({ id: character.id }) };
    expect(
      (
        await generate(
          http(owner, "POST", { ...request(), ownerId: randomUUID() }),
          context,
        )
      ).status,
    ).toBe(400);
    expect((await readCharacter(character.id, owner)).status).toBe("ready");
    expect(calls).toHaveLength(0);
  });
});
