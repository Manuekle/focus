import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAnalysis } from "../../shared/flipbook";
import { parsePoseToPose, planPoseToPose } from "./pose-to-pose-planning";
import { FlipbookPlanSchema, exposures } from "../../shared/flipbook";

const provider = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../ai/meta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/meta")>()),
  requireMetaConfig: vi.fn(() => ({ plannerModel: "test-planner" })),
  metaClient: () => ({ responses: { create: provider.complete } }),
}));
vi.mock("../ai/usage", () => ({ recordUsage: vi.fn() }));

const analysis: CharacterAnalysis = { characterCount: 1, subject: "character", facing: "front", view: "front", fullBodyVisible: true, feetVisible: true, background: "plain", style: "doodle", hair: "none", clothing: "none", accessories: [], palette: ["#000000"], proportions: "round head on hose legs", requestedAction: "jump" };

const pose = (role: string, extra: Record<string, unknown> = {}) => ({ role, label: role, description: `The ${role} pose.`, hold: 0, deform: "none", deformAmount: 0, height: 1, lift: 0, ...extra });
const jump = {
  overview: "Crouch at 0.2 s, leave the ground at 0.3 s, apex at 0.6 s, land at 1 s, settle by 1.2 s.",
  cameraView: "front",
  direction: "right",
  keys: [pose("idle"), pose("anticipation", { deform: "squash", deformAmount: 0.2 }), pose("breakdown", { deform: "stretch", deformAmount: 0.15 }), pose("action", { hold: 2 }), pose("breakdown"), pose("recoil", { deform: "squash", deformAmount: 0.2 }), pose("settle")],
  segments: [
    { ease: "in", inbetweens: 1, exposure: 2 },
    { ease: "none", inbetweens: 0, exposure: 2 },
    { ease: "in", inbetweens: 3, exposure: 2 },
    { ease: "out", inbetweens: 3, exposure: 2 },
    { ease: "none", inbetweens: 0, exposure: 1 },
    { ease: "in", inbetweens: 1, exposure: 2 },
  ],
};
const completed = (body: unknown) => ({ status: "completed", output_text: JSON.stringify(body) });

beforeEach(() => {
  provider.complete.mockReset();
  provider.complete.mockResolvedValue(completed(jump));
});

describe("parsePoseToPose", () => {
  it("reads keys, squash and stretch and the timing chart", () => {
    const chart = parsePoseToPose(JSON.stringify(jump), 2)!;
    expect(chart.keys.map((key) => key.role)).toEqual(["idle", "anticipation", "breakdown", "action", "breakdown", "recoil", "settle"]);
    expect(chart.keys[1].deform).toEqual({ kind: "squash", amount: 0.2 });
    expect(chart.keys[3].hold).toBe(2);
    expect(chart.segments[2]).toEqual({ ease: "in", inbetweens: 3, exposure: 2 });
  });

  it("drops a deform amount given with no deform", () => {
    const chart = parsePoseToPose(JSON.stringify({ ...jump, keys: jump.keys.map((key, index) => index === 0 ? { ...key, deformAmount: 0.3 } : key) }), 2)!;
    expect(chart.keys[0].deform).toEqual({ kind: "none", amount: 0 });
  });

  it("refuses a chart that doesn't fit", () => {
    expect(parsePoseToPose(JSON.stringify(jump), 1)).toBeNull();
    expect(parsePoseToPose(JSON.stringify({ ...jump, segments: jump.segments.map((segment) => ({ ...segment, inbetweens: 6 })) }), 2)).toBeNull();
    expect(parsePoseToPose(JSON.stringify({ ...jump, segments: jump.segments.slice(1) }), 2)).toBeNull();
    expect(parsePoseToPose(JSON.stringify({ ...jump, segments: [{ ...jump.segments[0], inbetweens: 40 }, ...jump.segments.slice(1)] }), 20)).toBeNull();
    expect(parsePoseToPose("not json", 2)).toBeNull();
  });

  it("refuses an action with no anticipation before it", () => {
    const keys = jump.keys.filter((key) => key.role !== "anticipation");
    expect(parsePoseToPose(JSON.stringify({ ...jump, keys, segments: jump.segments.slice(1) }), 2)).toBeNull();
  });
});

describe("planPoseToPose", () => {
  it("asks for keys and timing for the clip and returns a sequence plan at the chart's ticks", async () => {
    const plan = await planPoseToPose({ analysis, prompt: "Jump in place", settings: { durationSeconds: 2, drawingFps: 12 }, flipbookId: "test" });
    expect(plan.timing!.keys).toHaveLength(7);
    expect(plan).toMatchObject({ mode: "sequence", view: "front", direction: "right", action: "jump", durationSeconds: 2, loop: false });
    // 7 keys and 8 in-betweens, unevenly spaced.
    expect(plan.poses.map((pose) => Number(pose.phase.slice(7)))).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 25, 27, 29]);
    // The apex holds two extra ticks, the landing snaps on ones, the settle holds to the end.
    expect(exposures(plan.poses.map((pose) => pose.phase), 12, 48)).toEqual([2, 2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 1, 2, 2, 19]);
    expect(plan.poses[1].description).toMatch(/^In-between 75% of the way from the idle key .* easing in\.$/);
    expect(plan.poses[2].description).toContain("Squash the body about 20% shorter");
    const body = provider.complete.mock.calls[0][0];
    expect(JSON.parse(body.input[0].content[0].text)).toMatchObject({ instruction: "Jump in place", action: "jump", fullDurationTicks: 48, defaultExposure: 2 });
    expect(body.instructions).toContain("always anticipates");
    expect(body.instructions).toContain("on twos");
    // Pose-to-pose holds keys on purpose: the per-tick hold limit of a straight-ahead sequence doesn't apply.
    expect(body.instructions).not.toContain("125 ms");
  });

  it("keeps a timed plan's drawings on its chart", async () => {
    const plan = await planPoseToPose({ analysis, prompt: "Jump", settings: { durationSeconds: 2, drawingFps: 12 }, flipbookId: "test" });
    expect(FlipbookPlanSchema.safeParse(plan).success).toBe(true);
    // Even ticks, as a straight-ahead sequence would have, aren't the chart's.
    const even = plan.poses.map((pose, index) => ({ ...pose, phase: `sample_${index * 2}` }));
    expect(FlipbookPlanSchema.safeParse({ ...plan, poses: even }).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse({ ...plan, durationSeconds: 3 }).success).toBe(false);
  });

  it("retries once, then reports a plan that doesn't fit", async () => {
    provider.complete.mockResolvedValueOnce(completed({ ...jump, segments: [] })).mockResolvedValueOnce(completed(jump));
    await expect(planPoseToPose({ analysis, prompt: "Jump", settings: { durationSeconds: 2, drawingFps: 12 }, flipbookId: "test" })).resolves.toMatchObject({ action: "jump" });
    provider.complete.mockReset();
    provider.complete.mockResolvedValue(completed({ ...jump, segments: [] }));
    await expect(planPoseToPose({ analysis, prompt: "Jump", settings: { durationSeconds: 2, drawingFps: 12 }, flipbookId: "test" })).rejects.toMatchObject({ code: "pose_plan_invalid" });
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
});
