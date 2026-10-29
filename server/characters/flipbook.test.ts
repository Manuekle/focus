import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ACTION_SPECS, type CharacterAnalysis } from "../../shared/flipbook";
import {
  characterServices,
  generateCharacterVersion,
  updateCharacter,
} from "./characters";
import {
  characterAsset,
  characterDir,
  createCharacter,
  getCharacter,
} from "./store";
import { createFlipbook, services } from "../animation/flipbooks";
import {
  cleanupFlipbooks,
  flipbookFiles,
  getFlipbook,
} from "../animation/store";
import { parsePlanOutput } from "../animation/pose-planning";
import { segmentation } from "../animation/frame-alignment";

let root: string;
const ownerId = randomUUID();
const originalServices = { ...services };
const originalGenerate = characterServices.generate;
const originalSegment = segmentation.segment;
const oldData = process.env.FOCUS_DATA_DIR;
const oldFlag = process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "focus-character-flipbook-"));
  process.env.FOCUS_DATA_DIR = root;
  process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
  segmentation.segment = null;
});
afterAll(async () => {
  Object.assign(services, originalServices);
  characterServices.generate = originalGenerate;
  segmentation.segment = originalSegment;
  if (oldData === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = oldData;
  if (oldFlag === undefined) delete process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK;
  else process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = oldFlag;
  await rm(root, { recursive: true, force: true });
});

it("copies the selected Reze design and her original into Flipbook, independent of later changes and upload expiry", async () => {
  const reze = await readFile(
    path.join(process.cwd(), "public/characters/reze.jpeg"),
  );
  const character = await createCharacter(ownerId, {
    name: "Reze",
    png: reze,
    fileName: "reze.jpeg",
    preset: "reze",
  });
  characterServices.generate = async () => ({
    png: reze,
    width: 736,
    height: 1227,
  });
  await generateCharacterVersion(character.id, ownerId, {
    operationId: randomUUID(),
    prompt: "Prepare Reze",
    fromVersionId: null,
  });
  let generated = await getCharacter(character.id, ownerId);
  while (generated.status === "generating") {
    await new Promise((resolve) => setTimeout(resolve, 10));
    generated = await getCharacter(character.id, ownerId);
  }
  expect(generated.versions).toHaveLength(1);
  const selectedId = generated.selectedVersionId!;
  const originalIdentity = await readFile(
    characterAsset(character.id, character.references[0].id),
  );
  const selectedImage = await readFile(
    characterAsset(character.id, selectedId),
  );
  const analysis: CharacterAnalysis = {
    characterCount: 1,
    subject: "anime girl",
    facing: "right",
    view: "front",
    fullBodyVisible: false,
    feetVisible: false,
    background: "plain",
    style: "anime illustration",
    hair: "dark purple hair tied back",
    clothing: "white sleeveless shirt and black shorts",
    accessories: ["black neck ribbon"],
    palette: ["#d8c682", "#557449"],
    proportions: "slender full-body proportions",
    requestedAction: "wave",
  };
  services.analyze = async () => analysis;
  services.plan = async () =>
    parsePlanOutput(
      JSON.stringify({
        direction: "right",
        motion: "in_place",
        poses: ACTION_SPECS.wave.poses.map((pose) => ({
          phase: pose.phase,
          detail: "",
        })),
      }),
      analysis,
      "wave",
    );
  let originalReachedCleanReference = false;
  services.cleanReference = async (input) => {
    originalReachedCleanReference = Boolean(
      input.identityReference?.equals(originalIdentity),
    );
    return { png: reze, width: 736, height: 1227 };
  };
  const flipbook = await createFlipbook({
    characterSource: { characterId: character.id, versionId: selectedId },
    ownerId,
    prompt: "Wave hello",
    action: "wave",
  });
  let saved = await getFlipbook(flipbook.id);
  for (
    let tries = 0;
    saved.status !== "reference_ready" && tries < 200;
    tries++
  ) {
    if (["failed", "unsupported"].includes(saved.status))
      throw new Error(JSON.stringify(saved.error));
    await new Promise((resolve) => setTimeout(resolve, 20));
    saved = await getFlipbook(flipbook.id);
  }
  expect(saved.status).toBe("reference_ready");
  expect(originalReachedCleanReference).toBe(true);
  expect(saved.ownerId).toBe(ownerId);
  expect(saved.characterSource).toMatchObject({
    characterId: character.id,
    versionId: selectedId,
    name: "Reze",
  });
  expect(
    (await readFile(flipbookFiles.source(saved.id))).equals(selectedImage),
  ).toBe(true);
  expect(
    (await readFile(flipbookFiles.identity(saved.id))).equals(originalIdentity),
  ).toBe(true);
  await updateCharacter(character.id, ownerId, {
    action: "rename_version",
    versionId: selectedId,
    name: "Different label",
  });
  const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await utimes(characterDir(character.id), longAgo, longAgo);
  await cleanupFlipbooks();
  expect((await getCharacter(character.id, ownerId)).versions[0].name).toBe(
    "Different label",
  );
  expect((await getFlipbook(saved.id)).characterSource?.versionName).toBe(
    "Base design",
  );
  expect(
    (await readFile(flipbookFiles.source(saved.id))).equals(selectedImage),
  ).toBe(true);
});

it("keeps a requested frontal camera through all eight drawings even if a planner defaults to side view", async () => {
  const reze = await readFile(
    path.join(process.cwd(), "public/characters/reze.jpeg"),
  );
  const character = await createCharacter(ownerId, {
    name: "Reze frontal",
    png: reze,
    fileName: "reze.jpeg",
    preset: "reze",
  });
  characterServices.generate = async () => ({
    png: reze,
    width: 736,
    height: 1227,
  });
  await generateCharacterVersion(character.id, ownerId, {
    operationId: randomUUID(),
    prompt: "Full-body Reze",
    fromVersionId: null,
  });
  let source = await getCharacter(character.id, ownerId);
  while (source.status === "generating") {
    await new Promise((resolve) => setTimeout(resolve, 10));
    source = await getCharacter(character.id, ownerId);
  }
  const analysis: CharacterAnalysis = {
    characterCount: 1,
    subject: "anime girl",
    facing: "front",
    view: "front",
    fullBodyVisible: true,
    feetVisible: true,
    background: "plain",
    style: "anime illustration",
    hair: "dark purple hair",
    clothing: "green coat",
    accessories: [],
    palette: ["#456547"],
    proportions: "slender full-body proportions",
    requestedAction: "wave",
  };
  services.analyze = async () => analysis;
  services.plan = async () =>
    parsePlanOutput(
      JSON.stringify({
        direction: "right",
        motion: "in_place",
        poses: ACTION_SPECS.wave.poses.map((pose) => ({
          phase: pose.phase,
          detail: "",
        })),
      }),
      analysis,
      "wave",
      undefined,
      "side",
    );
  const views: (string | undefined)[] = [];
  services.draw = async (input) => {
    views.push(input.plan.view);
    expect(input.identityReference).toBeDefined();
    return { png: reze, width: 736, height: 1227 };
  };
  const created = await createFlipbook({
    characterSource: {
      characterId: source.id,
      versionId: source.selectedVersionId!,
    },
    ownerId,
    prompt: "Wave hello, facing the camera",
    view: "front",
    action: "wave",
  });
  let saved = await getFlipbook(created.id);
  for (let tries = 0; saved.status !== "ready" && tries < 500; tries++) {
    if (["failed", "unsupported", "reference_ready"].includes(saved.status))
      throw new Error(
        JSON.stringify({ status: saved.status, error: saved.error }),
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
    saved = await getFlipbook(created.id);
  }
  expect(saved.status).toBe("ready");
  expect(saved.requestedView).toBe("front");
  expect(saved.plan?.view).toBe("front");
  expect(saved.reference?.kind).toBe("original");
  expect(views).toEqual(Array(8).fill("front"));
  expect(
    saved.plan?.poses.every((pose) => !pose.description.includes("side view")),
  ).toBe(true);
});
