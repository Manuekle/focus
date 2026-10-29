import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAnalysis } from "../../shared/flipbook";
import { planSequence } from "./sequence-planning";

const provider = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../ai/meta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/meta")>()),
  requireMetaConfig: () => ({ plannerModel: "test-planner" }),
  metaClient: () => ({ responses: { create: provider.complete } }),
}));
vi.mock("../ai/usage", () => ({ recordUsage: vi.fn() }));

const analysis: CharacterAnalysis = { characterCount: 1, subject: "character", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain", style: "flat", hair: "short", clothing: "shirt", accessories: [], palette: ["#3366aa"], proportions: "human", requestedAction: "dance" };
type Context = { absoluteTicks: number[]; motionOverview: string; previousPoses: unknown[] };
function context(body: { input: { content: unknown[] }[] }): Context {
  return JSON.parse((body.input[0].content.at(-1) as { text: string }).text);
}
beforeEach(() => {
  provider.complete.mockReset();
  provider.complete.mockImplementation(async (body) => ({ status: "completed", output_text: JSON.stringify({ overview: "Begin at 0s, develop the dance across the full clip, finish at the chosen end.", visiblePeople: 1, poses: context(body).absoluteTicks.map((tick) => ({ tick, label: `At ${tick / 24}`, description: `Turn the body gradually at tick ${tick}.` })) }) }));
});

describe("bounded sequence planning requests", () => {
  it("plans all 480 ticks in ten absolute-time windows while retaining the global outline", async () => {
    const result = await planSequence({ analysis, prompt: "Dance throughout the clip", settings: { durationSeconds: 20, drawingFps: 24 }, flipbookId: "test" });
    expect(result.poses).toHaveLength(480);
    expect(provider.complete).toHaveBeenCalledTimes(10);
    const windows = provider.complete.mock.calls.map(([body]) => context(body));
    expect(windows.every((window) => window.absoluteTicks.length <= 48)).toBe(true);
    expect(windows.flatMap((window) => window.absoluteTicks)).toEqual(Array.from({ length: 480 }, (_, index) => index));
    expect(windows[1].motionOverview).toBe(result.motionOutline);
    expect(windows[1].previousPoses).toHaveLength(6);
  });
  it("adds only missing temporal samples when density increases", async () => {
    const initial = await planSequence({ analysis, prompt: "Dance", settings: { durationSeconds: 1, drawingFps: 8 }, flipbookId: "test" });
    provider.complete.mockClear();
    const dense = await planSequence({ analysis, prompt: "Dance", previous: initial, settings: { durationSeconds: 1, drawingFps: 24 }, flipbookId: "test" });
    expect(context(provider.complete.mock.calls[0][0]).absoluteTicks).toHaveLength(16);
    for (const pose of initial.poses) expect(dense.poses.find((entry) => entry.phase === pose.phase)?.description).toBe(pose.description);
  });
  it("rejects an eight-drawing substitution with a bounded retry", async () => {
    provider.complete.mockImplementation(async (body) => ({ status: "completed", output_text: JSON.stringify({ poses: context(body).absoluteTicks.slice(0, 8).map((tick) => ({ tick, label: "Pose", description: "Move." })) }) }));
    await expect(planSequence({ analysis, prompt: "Dance", settings: { durationSeconds: 4, drawingFps: 24 }, flipbookId: "test" })).rejects.toMatchObject({ code: "pose_plan_invalid" });
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
  it("rejects a multi-person reference before planning later windows", async () => {
    provider.complete.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ visiblePeople: 2, poses: [] }) });
    await expect(planSequence({ analysis, prompt: "Dance", settings: { durationSeconds: 4, drawingFps: 24 }, flipbookId: "test", guide: async () => Buffer.from("test guide") })).rejects.toMatchObject({ code: "motion_subject_unclear" });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});
