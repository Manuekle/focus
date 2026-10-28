import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEnsembleRequestSchema, type CharacterAnalysis, type Flipbook, type FlipbookStatus } from "../../shared/flipbook";
import { AppError } from "../errors";
import { applyFrameAction, createEnsemble, drawInbetweens, exportFlipbook, generateMissing, reorderFrames, changeReference, services } from "./flipbooks";
import { segmentation } from "./frame-alignment";
import { parseEnsembleOutput } from "./ensemble-planning";
import { flipbookFiles, getFlipbook } from "./store";

// A scene of several saved characters with every paid call replaced by a
// deterministic fake: Muse Spark returns fixed JSON, Muse Image returns two
// blocks that move from beat to beat, SAM is off (key-background cut-outs).

vi.mock("../characters/flipbook-source", () => ({
  animationCharacterSource: async (source: { characterId: string; versionId: string }, ownerId: string | null | undefined) => {
    const { AppError: Failure } = await import("../errors");
    if (!ownerId) throw new Failure("login_required", 401, "Sign in to use your saved character.");
    const { walkerPng: draw } = await import("./__fixtures__/walker");
    const png = await draw("left_passing");
    return {
      image: { id: source.characterId, originalName: "Saved", width: 1024, height: 1536, hasAlpha: false, createdAt: new Date().toISOString(), url: "/characters" },
      png,
      flat: png,
      identity: png,
      origin: { ...source, name: `Hero ${source.characterId.slice(0, 4)}`, versionName: "Base" },
    };
  },
}));

let work: string;
const ownerId = randomUUID();
const source = () => ({ characterId: randomUUID(), versionId: "v-123456789abc" });

const analysis: CharacterAnalysis = {
  characterCount: 1, subject: "walker", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain",
  style: "flat vector, no outlines", hair: "short red cap of hair", clothing: "blue shirt", accessories: [],
  palette: ["#2e86de", "#34495e", "#c0392b", "#f1c27d"], proportions: "big round head", requestedAction: "walk",
};

const calls = { analyze: 0, plan: 0, draw: 0, indices: [] as number[], castSizes: [] as number[], neighbors: new Map<number, number | null>(), repairs: 0 };
const drawn = new Map<string, number>();
let failing = new Map<number, AppError>();

/** Two blocks on a wide white page: the first walks right, the second left, one step per beat. */
async function scenePng(index: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#ffffff"/>`
    + `<rect x="${300 + index * 12}" y="420" width="170" height="480" rx="30" fill="#c0392b"/>`
    + `<rect x="${1000 - index * 12}" y="450" width="170" height="450" rx="30" fill="#2e86de"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function waitFor(id: string, statuses: readonly FlipbookStatus[], timeoutMs = 45_000): Promise<Flipbook> {
  const started = Date.now();
  for (;;) {
    const flipbook = await getFlipbook(id);
    if (statuses.includes(flipbook.status)) return flipbook;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out in ${flipbook.status}: ${JSON.stringify(flipbook.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

const make = (seconds: number, prompt = "they fight: a punch, a dodge and a kick") => createEnsemble({ cast: [source(), source()], prompt, seconds, ownerId });

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-ensemble-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
  process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
  segmentation.segment = null;
  services.analyze = async () => { calls.analyze++; return analysis; };
  services.planEnsemble = async ({ seconds, view }) => {
    calls.plan++;
    const count = seconds * 8;
    return parseEnsembleOutput(JSON.stringify({ direction: "right", beats: Array.from({ length: count }, (_, index) => ({ title: `Beat ${index + 1}`, description: `Character 1 closes in on Character 2, beat ${index + 1}.` })) }), { seconds, view });
  };
  services.drawEnsemble = async ({ cast, neighbor, repair, index }) => {
    calls.draw++;
    calls.indices.push(index);
    calls.castSizes.push(cast.length);
    if (repair) calls.repairs++;
    calls.neighbors.set(index, neighbor ? (drawn.get(createHash("sha1").update(neighbor).digest("hex")) ?? -1) : null);
    const failure = failing.get(index);
    if (failure) throw failure;
    const png = await scenePng(index);
    drawn.set(createHash("sha1").update(png).digest("hex"), index);
    return { png, width: 1536, height: 1024 };
  };
});

beforeEach(() => {
  failing = new Map();
  calls.neighbors.clear();
  calls.indices.length = 0;
  calls.castSizes.length = 0;
  calls.repairs = 0;
});

describe("a scene of several characters", () => {
  let scene: Flipbook;
  /** Which drawing each one leaned on while the scene was first drawn; later tests reset the live record. */
  let leaned: Map<number, number | null>;

  it("draws as many frames as the duration asks for, all the characters together in each", async () => {
    const before = { analyze: calls.analyze, plan: calls.plan, draw: calls.draw };
    const created = await make(2);
    expect(created.status).toBe("analyzing");
    expect(created.frames).toHaveLength(16);
    expect(created.budget).toEqual({ limit: 16, used: 0 });
    scene = await waitFor(created.id, ["ready", "failed", "reference_ready"]);
    leaned = new Map(calls.neighbors);
    expect(scene.status).toBe("ready");
    expect(calls.analyze - before.analyze).toBe(2);
    expect(calls.plan - before.plan).toBe(1);
    expect(calls.draw - before.draw).toBe(16);
    expect(new Set(calls.castSizes)).toEqual(new Set([2]));
    expect(scene.cast).toHaveLength(2);
    expect(scene.cast.every((member) => member.analysis?.subject === "walker")).toBe(true);
    expect(scene.analysis?.characterCount).toBe(2);
    expect(scene.characterSource).toBeUndefined();
    expect(scene.order).toEqual(Array.from({ length: 16 }, (_, index) => `f${index}`));
    expect(scene.plan).toMatchObject({ action: "ensemble", durationSeconds: 2, drawingFps: 8, motion: "in_place" });
    expect(scene.plan?.poses).toHaveLength(16);
    expect(scene.frames.map((frame) => frame.label).slice(0, 2)).toEqual(["Beat 1", "Beat 2"]);
    expect(scene.budget).toEqual({ limit: 16, used: 16 });
    expect(scene.reference?.kind).toBe("original");
  });

  it("registers every drawing on a fixed camera: they keep the place they were drawn at", async () => {
    const alignment = scene.alignment!;
    expect(alignment.cellHeight).toBe(768);
    expect(alignment.cellWidth).toBe(1152);
    expect(alignment.strideX).toBe(0);
    expect(alignment.strideMeasured).toBe(false);
    for (const frame of scene.frames) {
      expect(frame.status).toBe("ready");
      expect(frame.metrics?.extraction).toBe("key");
      expect(alignment.transforms[frame.id]?.version).toBe(frame.version);
      // Both blocks are in the cut-out, not just the larger one.
      expect(frame.warnings.map((warning) => warning.code)).not.toContain("multiple_subjects");
      expect(frame.warnings.map((warning) => warning.code)).not.toContain("body_offset");
    }
    const first = alignment.transforms.f0!, last = alignment.transforms.f15!;
    expect(first.scale).toBeCloseTo(0.75, 3);
    // The left block starts at x=300 of 1536 and walks right 12 px a beat, 15 beats: its sprite sits where it was drawn, never re-centered.
    expect(Math.abs(first.left - 300 * 0.75)).toBeLessThan(6);
    expect(last.left - first.left).toBeGreaterThan(120);
    expect(last.left - first.left).toBeLessThan(150);
    const sprite = await sharp(await readFile(flipbookFiles.sprite(scene.id, "f0", first.key))).metadata();
    expect([sprite.width, sprite.height]).toEqual([1152, 768]);
  });

  it("leans each drawing on the one before it, two beats back so two can be drawn at once", () => {
    expect(leaned.get(0)).toBeNull();
    expect(leaned.get(1)).toBe(0);
    for (let index = 2; index < 16; index++) expect(leaned.get(index)).toBe(index - 2);
  });

  it("plays exactly as long as asked, whatever the settings say", async () => {
    const result = await exportFlipbook(scene.id, { format: "mp4", settings: { drawingFps: 12, durationSeconds: 6, motion: "left", aspect: "16:9", speed: 1 }, background: { kind: "color", color: "#ffffff" } });
    expect(result.record.settings).toMatchObject({ drawingFps: 8, durationSeconds: 2, motion: "in_place" });
    expect(result.record.facts.frames).toBe(48);
    expect(result.record.facts.durationSeconds).toBeGreaterThan(1.9);
    expect(result.record.facts.durationSeconds).toBeLessThan(2.1);
  });

  it("redraws one drawing from both characters and the drawing before it", async () => {
    await applyFrameAction(scene.id, "f5", { action: "regenerate", confirmExtra: true });
    const redone = await waitFor(scene.id, ["ready"]);
    expect(calls.indices).toEqual([5]);
    expect(calls.castSizes).toEqual([2]);
    expect(calls.neighbors.get(5)).toBe(4);
    expect(redone.budget).toEqual({ limit: 17, used: 17 });
    expect(redone.frames[5].versions).toHaveLength(2);
    expect(redone.alignment?.transforms.f5?.version).toBe(redone.frames[5].version);
  });

  it("repairs a drawing without losing a character", async () => {
    await applyFrameAction(scene.id, "f7", { action: "enhance", confirmExtra: true });
    await waitFor(scene.id, ["ready"]);
    expect(calls.repairs).toBe(1);
    expect(calls.castSizes).toEqual([2]);
  });

  it("keeps a drawing that failed visible, refunds what Meta doesn't bill, and draws only that one again", async () => {
    failing.set(3, new AppError("image_blocked", 422, "Blocked."));
    const created = await make(1);
    const partial = await waitFor(created.id, ["ready", "failed", "reference_ready"]);
    expect(partial.frames.filter((frame) => frame.status === "failed").map((frame) => frame.id)).toEqual(["f3"]);
    expect(partial.frames.filter((frame) => frame.status === "ready")).toHaveLength(7);
    expect(partial.budget.used).toBe(7);
    expect(partial.status).toBe("ready");
    // Asking again draws only that one, leaning on the drawing before it.
    failing = new Map();
    calls.indices.length = 0;
    await generateMissing(partial.id, false);
    const whole = await waitFor(partial.id, ["ready"]);
    expect(calls.indices).toEqual([3]);
    expect(calls.neighbors.get(3)).toBe(2);
    expect(whole.frames.every((frame) => frame.status === "ready")).toBe(true);
    expect(whole.budget.used).toBe(8);
  });

  it("opens the budget for a longer scene, and a 6 s scene has 48 drawings", async () => {
    const created = await make(6);
    expect(created.frames).toHaveLength(48);
    expect(created.budget.limit).toBe(48);
    const done = await waitFor(created.id, ["ready", "failed", "reference_ready"], 90_000);
    expect(done.status).toBe("ready");
    expect(done.budget).toEqual({ limit: 48, used: 48 });
    expect(done.order.at(-1)).toBe("f47");
    expect(Object.keys(done.alignment!.transforms)).toHaveLength(48);
  }, 120_000);

  it("leaves out what only a cycle of eight can do", async () => {
    await expect(drawInbetweens(scene.id, false)).rejects.toMatchObject({ code: "not_for_scenes" });
    await expect(reorderFrames(scene.id, scene.order)).rejects.toMatchObject({ code: "not_for_scenes" });
    await expect(changeReference(scene.id, "clean", {})).rejects.toMatchObject({ code: "not_for_scenes" });
  });
});

describe("starting a scene", () => {
  it("needs a signed-in account: the characters are private", async () => {
    await expect(createEnsemble({ cast: [source(), source()], prompt: "they dance", seconds: 2, ownerId: null })).rejects.toMatchObject({ code: "login_required" });
  });

  it("takes two to four different characters, and 1 to 6 seconds", () => {
    const a = source(), b = source(), c = source(), d = source(), e = source();
    const parse = (cast: unknown[], seconds = 2) => CreateEnsembleRequestSchema.safeParse({ cast, prompt: "they dance", seconds }).success;
    expect(parse([a])).toBe(false);
    expect(parse([a, b])).toBe(true);
    expect(parse([a, b, c, d])).toBe(true);
    expect(parse([a, b, c, d, e])).toBe(false);
    expect(parse([a, a])).toBe(false);
    expect(parse([a, { ...a, versionId: "v-aaaaaaaaaaaa" }])).toBe(true);
    expect(parse([a, b], 0)).toBe(false);
    expect(parse([a, b], 7)).toBe(false);
    expect(parse([a, b], 2.5)).toBe(false);
    expect(CreateEnsembleRequestSchema.safeParse({ cast: [a, b], prompt: "x", seconds: 2 }).success).toBe(false);
  });
});
