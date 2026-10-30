import { describe, expect, it } from "vitest";
import { TimingChartSchema, deformInstruction, liftTrack, inbetweenOrder, inbetweenPositions, keyTicks, timeline, type TimingChart, type TimingKey } from "./timing-chart";

const key = (role: TimingKey["role"], hold = 0, deform: TimingKey["deform"] = { kind: "none", amount: 0 }): TimingKey => ({ role, label: role, description: `The ${role} pose.`, hold, deform, lift: role === "action" ? 0.6 : 0 });

// The class project's jump: idle, anticipation, breakdown, action (apex), breakdown, recoil, settle.
const jump: TimingChart = {
  durationSeconds: 2,
  keys: [key("idle"), key("anticipation", 0, { kind: "squash", amount: 0.2 }), key("breakdown", 0, { kind: "stretch", amount: 0.15 }), key("action", 2), key("breakdown"), key("recoil", 0, { kind: "squash", amount: 0.2 }), key("settle")],
  segments: [
    { ease: "in", inbetweens: 1, exposure: 2 },
    { ease: "none", inbetweens: 0, exposure: 2 },
    { ease: "in", inbetweens: 3, exposure: 2 },
    { ease: "out", inbetweens: 3, exposure: 2 },
    { ease: "none", inbetweens: 0, exposure: 1 },
    { ease: "in", inbetweens: 1, exposure: 2 },
  ],
};

describe("inbetweenPositions", () => {
  it("spaces evenly without ease", () => {
    expect(inbetweenPositions("none", 3)).toEqual([0.25, 0.5, 0.75]);
  });

  it("bunches drawings near the slow key", () => {
    const into = inbetweenPositions("in", 3), outOf = inbetweenPositions("out", 3);
    // Easing in: big steps first, then smaller ones into the next key.
    const steps = [into[0], into[1] - into[0], into[2] - into[1], 1 - into[2]];
    for (let index = 1; index < steps.length; index++) expect(steps[index]).toBeLessThan(steps[index - 1]);
    // Easing out mirrors it.
    outOf.forEach((position, index) => expect(position).toBeCloseTo(1 - into[into.length - 1 - index], 10));
  });

  it("is slow at both ends easing in and out", () => {
    const [a, b, c, d, e] = inbetweenPositions("in_out", 5);
    expect(c).toBeCloseTo(0.5, 10);
    expect(a).toBeLessThan(b - a);
    expect(1 - e).toBeLessThan(e - d);
  });

  it("favors a single in-between toward the slow key", () => {
    expect(inbetweenPositions("in", 1)[0]).toBeGreaterThan(0.5);
    expect(inbetweenPositions("out", 1)[0]).toBeLessThan(0.5);
    expect(inbetweenPositions("none", 1)).toEqual([0.5]);
    expect(inbetweenPositions("in", 0)).toEqual([]);
  });
});

describe("timeline", () => {
  it("places keys by hold, exposure and in-between count", () => {
    // 0 → +4 → +2 → +8 → +2+8 → +1 → +4.
    expect(keyTicks(jump)).toEqual([0, 4, 6, 14, 24, 25, 29]);
  });

  it("covers the clip without gaps and lets the last key hold to the end", () => {
    const drawings = timeline(jump);
    expect(drawings.filter((drawing) => drawing.kind === "key")).toHaveLength(7);
    expect(drawings.filter((drawing) => drawing.kind === "inbetween")).toHaveLength(8);
    drawings.forEach((drawing, index) => {
      if (index) expect(drawing.tick).toBe(drawings[index - 1].tick + drawings[index - 1].ticks);
    });
    const last = drawings.at(-1)!;
    expect(last).toMatchObject({ id: "k6", role: "settle", tick: 29, ticks: 48 - 29 });
  });

  it("holds a key on screen for its hold plus one exposure", () => {
    expect(timeline(jump).find((drawing) => drawing.id === "k3")).toMatchObject({ tick: 14, ticks: 4 });
  });

  it("rejects a chart that runs past the clip or misses a segment", () => {
    expect(TimingChartSchema.safeParse(jump).success).toBe(true);
    // The settle starts at tick 29: past a one-second clip.
    expect(TimingChartSchema.safeParse({ ...jump, durationSeconds: 1 }).success).toBe(false);
    expect(TimingChartSchema.safeParse({ ...jump, segments: jump.segments.slice(1) }).success).toBe(false);
  });
});

describe("inbetweenOrder", () => {
  it("draws the middle first, then each half between finished drawings", () => {
    const tasks = inbetweenOrder(jump, 2);
    expect(tasks.map((task) => task.id)).toEqual(["k2.1", "k2.0", "k2.2"]);
    expect(tasks[0]).toMatchObject({ from: "k2", to: "k3" });
    expect(tasks[1]).toMatchObject({ from: "k2", to: "k2.1" });
    expect(tasks[2]).toMatchObject({ from: "k2.1", to: "k3" });
    const made = new Set(["k2", "k3"]);
    for (const task of tasks) {
      expect(made.has(task.from) && made.has(task.to)).toBe(true);
      made.add(task.id);
    }
  });

  it("keeps each task's position between its own neighbors", () => {
    const chart = { ...jump, segments: jump.segments.map((segment, index) => index === 2 ? { ...segment, inbetweens: 7 } : segment), durationSeconds: 3 };
    const tasks = inbetweenOrder(chart, 2);
    expect(tasks).toHaveLength(7);
    for (const task of tasks) {
      expect(task.position).toBeGreaterThan(0.2);
      expect(task.position).toBeLessThan(0.8);
    }
    // Rebuilding every absolute position from the tasks lands on the eased spacing.
    const at = new Map([["k2", 0], ["k3", 1]]);
    for (const task of tasks) at.set(task.id, at.get(task.from)! + (at.get(task.to)! - at.get(task.from)!) * task.position);
    inbetweenPositions("in", 7).forEach((position, step) => expect(at.get(`k2.${step}`)).toBeCloseTo(position, 10));
  });

  it("has nothing to draw on a snap or after the last key", () => {
    expect(inbetweenOrder(jump, 1)).toEqual([]);
    expect(inbetweenOrder(jump, 6)).toEqual([]);
  });
});

describe("liftTrack", () => {
  it("rises to the apex slowing down and falls speeding up, as the spacing does", () => {
    const track = liftTrack(jump);
    const drawings = timeline(jump);
    const lift = (id: string) => track[drawings.findIndex((drawing) => drawing.id === id)];
    expect(lift("k3")).toBe(0.6);
    expect(lift("k0")).toBe(0);
    // Easing into the apex: the last step up is the smallest.
    const up = ["k2", "k2.0", "k2.1", "k2.2", "k3"].map(lift);
    expect(up[4] - up[3]).toBeLessThan(up[1] - up[0]);
    // Easing out of it: the first step down is the smallest.
    const down = ["k3", "k3.0", "k3.1", "k3.2", "k4"].map(lift);
    expect(down[0] - down[1]).toBeLessThan(down[3] - down[4]);
    expect(track.at(-1)).toBe(0);
  });
});

describe("deformInstruction", () => {
  it("keeps the volume of a squash or stretch", () => {
    expect(deformInstruction({ kind: "squash", amount: 0.2 })).toContain("20% shorter and as much wider");
    expect(deformInstruction({ kind: "stretch", amount: 0.15 })).toContain("15% taller and as much narrower");
    expect(deformInstruction({ kind: "none", amount: 0 })).toBe("");
  });
});
