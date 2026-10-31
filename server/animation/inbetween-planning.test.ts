import { describe, expect, it } from "vitest";
import { currentInbetweenPlan, easeProgress, maxPlannedInbetweens, plannedInbetweenTargets, plannedTargets, playbackCycle, type Flipbook, type InbetweenPlan } from "../../shared/flipbook";
import { neededInbetweens, parseInbetweenPlan, type GapMeasure } from "./inbetween-planning";

const gap = (index: number, movement: Partial<GapMeasure> = {}): GapMeasure => ({
  from: `f${index}`, to: `f${(index + 1) % 8}`, fromVersion: `v-00000000000${index}`, toVersion: `v-00000000000${(index + 1) % 8}`,
  fromLabel: `Key ${index + 1}`, toLabel: `Key ${(index + 1) % 8 + 1}`, share: 1 / 8, turn: 20, travel: 0.1, silhouette: 0.05, ...movement,
});
const measures = Array.from({ length: 8 }, (_, index) => gap(index));
const answer = (cycleSeconds: number, counts: readonly number[], ease = "in_out") => JSON.stringify({ cycleSeconds, summary: "Slow walk.", gaps: counts.map((count) => ({ count, ease, note: "why" })) });

describe("calculated in-betweens", () => {
  it("suggests more in-betweens where the body moves more, and more at a gentle pace", () => {
    expect(neededInbetweens({ turn: 4, travel: 0.02, silhouette: 0.02 }, "normal")).toBe(0);
    expect(neededInbetweens({ turn: 40, travel: 0.1, silhouette: 0.05 }, "normal")).toBe(2);
    expect(neededInbetweens({ turn: 40, travel: 0.1, silhouette: 0.05 }, "gentle")).toBe(3);
    // Only the outline measured: it still decides.
    expect(neededInbetweens({ turn: null, travel: null, silhouette: 0.3 }, "gentle")).toBe(5);
  });

  it("keeps each gap within the time it has at one drawing per 24 fps frame", () => {
    expect(maxPlannedInbetweens(1 / 8)).toBe(2);
    expect(maxPlannedInbetweens(2 / 8)).toBe(5);
    expect(maxPlannedInbetweens(3 / 8)).toBe(7);
    const fast = parseInbetweenPlan(answer(1, [7, 7, 7, 7, 1, 0, 3, 2]), measures)!;
    expect(fast.cycleSeconds).toBe(1);
    expect(fast.gaps.map((entry) => entry.count)).toEqual([2, 2, 2, 2, 1, 0, 2, 2]);
    const slow = parseInbetweenPlan(answer(2, [7, 4, 3, 3, 1, 0, 3, 2]), measures)!;
    expect(slow.gaps.map((entry) => entry.count)).toEqual([5, 3, 3, 3, 1, 0, 3, 2]);
    expect(slow.gaps[0]).toMatchObject({ from: "f0", to: "f1", fromVersion: "v-000000000000", ease: "in_out", note: "why", turn: 20 });
  });

  it("refuses an answer that doesn't cover every gap and clamps the cycle", () => {
    expect(parseInbetweenPlan(answer(2, [1, 1]), measures)).toBeNull();
    expect(parseInbetweenPlan("not json", measures)).toBeNull();
    expect(parseInbetweenPlan(answer(30, [1, 1, 1, 1, 1, 1, 1, 1]), measures)!.cycleSeconds).toBe(8);
  });

  it("times in-betweens evenly and spaces their poses by the gap's easing", () => {
    expect(easeProgress(0.5, "none")).toBe(0.5);
    expect(easeProgress(0.25, "in_out")).toBeLessThan(0.25);
    expect(easeProgress(0.25, "in")).toBeGreaterThan(0.25);
    expect(easeProgress(0.25, "out")).toBeLessThan(0.25);
    const plan = parseInbetweenPlan(answer(2, [3, 0, 1, 0, 0, 0, 0, 0]), measures)!;
    const targets = plannedTargets(plan);
    expect(targets.map((target) => target.id)).toEqual(["i0-1of4", "i0", "i0-3of4", "i2"]);
    expect(targets[0].position).toBe(0.25);
    expect(targets[0].progress).toBeCloseTo(0.15625);
    expect(targets[1].progress).toBe(0.5);
  });

  it("plays only the plan's own in-betweens while it still fits the keys", () => {
    const plan: InbetweenPlan = parseInbetweenPlan(answer(2, [1, 0, 0, 0, 0, 0, 0, 0], "none"), measures)!;
    const frames = measures.map((entry, index) => ({ id: entry.from, poseIndex: index, phase: "left_contact", label: entry.fromLabel, status: "ready", version: entry.fromVersion }));
    const ready = (id: string, position: number, progress?: number) => ({ id, from: "f0", to: "f1", fromVersion: "v-000000000000", toVersion: "v-000000000001", position, ...(progress === undefined ? {} : { progress }), status: "ready", version: "v-aaaaaaaaaaaa", error: null });
    const transforms = Object.fromEntries(["i0", "i0-1of3"].map((id) => [id, { version: "v-aaaaaaaaaaaa", scale: 1, left: 0, top: 0, key: "0123456789abcdef" }]));
    const flipbook = { frames, order: frames.map((frame) => frame.id), alignment: { transforms }, inbetweens: [ready("i0", 0.5), ready("i0-1of3", 1 / 3)], inbetweenPlan: plan } as unknown as Flipbook;
    expect(currentInbetweenPlan(flipbook)).toBe(plan);
    expect(playbackCycle(flipbook, true).filter((drawing) => drawing.inbetween).map((drawing) => drawing.id)).toEqual(["i0"]);
    expect(plannedInbetweenTargets(flipbook)).toEqual([]);
    // Without the plan, every current density plays as before.
    expect(playbackCycle({ ...flipbook, inbetweenPlan: null }, true).filter((drawing) => drawing.inbetween).map((drawing) => drawing.id)).toEqual(["i0-1of3", "i0"]);
    // A redrawn key makes the plan stale.
    const redrawn = { ...flipbook, frames: frames.map((frame) => (frame.id === "f1" ? { ...frame, version: "v-bbbbbbbbbbbb" } : frame)) } as unknown as Flipbook;
    expect(currentInbetweenPlan(redrawn)).toBeNull();
    // An eased plan needs its own drawing even where an even one has the same id.
    const eased = { ...flipbook, inbetweenPlan: parseInbetweenPlan(answer(2, [3, 0, 0, 0, 0, 0, 0, 0], "in_out"), measures)! } as unknown as Flipbook;
    expect(plannedInbetweenTargets(eased).map((target) => target.id)).toEqual(["i0-1of4", "i0-3of4"]);
  });
});

describe("in-betweens played in the order they read", () => {
  it("fills a gap's time slots by where each drawing actually sits along the movement", () => {
    const frames = measures.map((entry, index) => ({ id: entry.from, poseIndex: index, phase: "left_contact", label: entry.fromLabel, status: "ready", version: entry.fromVersion }));
    const drawn = (id: string, position: number, seen?: number) => ({ id, from: "f0", to: "f1", fromVersion: "v-000000000000", toVersion: "v-000000000001", position, ...(seen === undefined ? {} : { seen }), status: "ready", version: "v-aaaaaaaaaaaa", error: null });
    const ids = ["i0-1of4", "i0", "i0-3of4"];
    const transforms = Object.fromEntries(ids.map((id) => [id, { version: "v-aaaaaaaaaaaa", scale: 1, left: 0, top: 0, key: "0123456789abcdef" }]));
    // The first was asked for at a quarter but reads nearly at the next key.
    const flipbook = { frames, order: frames.map((frame) => frame.id), alignment: { transforms }, inbetweens: [drawn("i0-1of4", 0.25, 0.8), drawn("i0", 0.5, 0.3), drawn("i0-3of4", 0.75, 0.6)] } as unknown as Flipbook;
    const played = playbackCycle(flipbook, true).filter((drawing) => drawing.inbetween);
    expect(played.map((drawing) => drawing.id)).toEqual(["i0", "i0-3of4", "i0-1of4"]);
    expect(played.map((drawing) => drawing.position)).toEqual([0.25, 0.5, 0.75]);
    // Unmeasured drawings keep their planned order.
    const plain = { ...flipbook, inbetweens: [drawn("i0-3of4", 0.75), drawn("i0-1of4", 0.25), drawn("i0", 0.5)] } as unknown as Flipbook;
    expect(playbackCycle(plain, true).filter((drawing) => drawing.inbetween).map((drawing) => drawing.id)).toEqual(["i0-1of4", "i0", "i0-3of4"]);
  });
});
