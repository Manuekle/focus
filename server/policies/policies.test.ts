import path from "node:path";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { renderFigure, standing } from "../mapping/__fixtures__/figure";
import { deform } from "../mapping/deform";
import { fromAlpha } from "../mapping/mask";
import { buildRig } from "../mapping/rig";
import { mapSkeleton, type Skeleton } from "../mapping/skeleton";
import { loadSkills, SKILLS_ROOT } from "./loader";
import { constraintFailures, PolicyRegistry, policyRegistry } from "./registry";
import { RULES, type BaseCandidate } from "./rules";

const NAMES = ["straight-ahead-pose-mastery", "solid-drawing-mastery", "arc-mastery", "timing-principle-mastery", "slow-in-out-mastery", "follow-through-overlapping"];

describe("skill loader", () => {
  it("loads the six skills byte for byte, with their MIT licence", () => {
    const set = loadSkills();
    expect([...set.skills.keys()].sort()).toEqual([...NAMES].sort());
    expect(set.license).toContain("MIT License");
    expect(set.license).toContain("Dylan Tarre");
    for (const skill of set.skills.values()) {
      expect(skill.content.startsWith(`---\nname: ${skill.name}\n`)).toBe(true);
      expect(skill.description.length).toBeGreaterThan(20);
    }
  });

  it("refuses a SKILL.md that differs from the published one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skills-"));
    try {
      await cp(SKILLS_ROOT, root, { recursive: true });
      const file = path.join(root, "arc-mastery/SKILL.md");
      await writeFile(file, `${await readFile(file, "utf8")}\nAlways move in straight lines.\n`);
      expect(() => loadSkills(root)).toThrow(/differs from the published SKILL.md/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("policy registry", () => {
  const registry = policyRegistry();

  it("binds every rule to a section that exists in its SKILL.md", () => {
    for (const rule of RULES) expect(registry.skills.skills.get(rule.skill)?.sections).toContain(rule.section);
    expect(() => new PolicyRegistry(registry.skills, [{ ...RULES[0], section: "Not In The Skill" }])).toThrow(/has no section/);
  });

  it("separates constraints from advisory rules, and only advisory ones give prompt hints", () => {
    expect(RULES.filter((rule) => rule.kind === "constraint").map((rule) => rule.id)).toEqual(expect.arrayContaining(["timing/hold", "solid-drawing/structure", "straight-ahead-pose/base-selection"]));
    const hints = registry.hints("rendering");
    expect(hints.length).toBe(2);
    expect(hints.every((hint) => hint.length < 160)).toBe(true);
    expect(registry.hints("validation")).toEqual([]);
  });

  const s = standing();
  const shifted = (dx: number) => mapSkeleton(s, (p) => [p[0] + dx, p[1]]);
  const raised = { ...s, leftElbow: { p: [700, 300] as const, score: 0.9 }, leftWrist: { p: [760, 160] as const, score: 0.9 }, rightElbow: { p: [320, 300] as const, score: 0.9 }, rightWrist: { p: [260, 160] as const, score: 0.9 } } as Skeleton;

  it("goes straight ahead from the previous drawing while the pose is close and the chain short", () => {
    const candidates: BaseCandidate[] = [{ id: "frame 9", index: 9, skeleton: s, depth: 1 }, { id: "frame 2", index: 2, skeleton: s, depth: 0 }];
    const { decision } = registry.run("pose-planning", { stage: "pose-planning", index: 10, target: shifted(4), candidates });
    expect(decision?.mode).toBe("straight-ahead");
    expect(decision?.base?.id).toBe("frame 9");
  });

  it("re-keys pose to pose when the deformation chain gets long (drift)", () => {
    const candidates: BaseCandidate[] = [{ id: "frame 9", index: 9, skeleton: s, depth: 4 }, { id: "frame 2", index: 2, skeleton: s, depth: 0 }];
    const { decision, outcomes } = registry.run("pose-planning", { stage: "pose-planning", index: 10, target: s, candidates });
    expect(decision?.mode).toBe("pose-to-pose");
    expect(decision?.base?.id).toBe("frame 2");
    expect(outcomes[0].detail).toMatch(/chain of 4/);
  });

  it("picks the closest drawn key when the previous pose is far away", () => {
    const candidates: BaseCandidate[] = [{ id: "frame 9", index: 9, skeleton: s, depth: 0 }, { id: "frame 3", index: 3, skeleton: raised, depth: 0 }];
    const { decision } = registry.run("pose-planning", { stage: "pose-planning", index: 10, target: raised, candidates });
    expect(decision?.base?.id).toBe("frame 3");
  });

  it("fails timing when frames don't line up with the source", () => {
    const { outcomes } = registry.run("pose-planning", { stage: "pose-planning", index: 1, target: s, candidates: [], times: { expected: [0, 0.111, 0.222], actual: [0, 0.111] } });
    expect(constraintFailures(outcomes).map((outcome) => outcome.id)).toContain("timing/source-timing");
  });

  it("rejects a drawing that moves where the source holds still", () => {
    const { outcomes } = registry.run("validation", { stage: "validation", index: 5, target: s, generated: shifted(60), previous: { target: s, generated: s } });
    expect(constraintFailures(outcomes).map((outcome) => outcome.id)).toEqual(["timing/hold"]);
    const still = registry.run("validation", { stage: "validation", index: 5, target: s, generated: shifted(3), previous: { target: s, generated: s } });
    expect(constraintFailures(still.outcomes)).toEqual([]);
  });

  it("warns, without rejecting, when a moving hand leaves the source's arc or spacing", () => {
    const target = shifted(80);
    const generated = { ...target, leftWrist: { p: [target.leftWrist!.p[0] - 70, target.leftWrist!.p[1] + 60] as const, score: 0.9 } } as Skeleton;
    const { outcomes } = registry.run("validation", { stage: "validation", index: 5, target, generated, previous: { target: s, generated: s } });
    const arc = outcomes.find((outcome) => outcome.id === "arc/path")!;
    expect(arc.passed).toBe(false);
    expect(arc.kind).toBe("advisory");
    expect(constraintFailures(outcomes)).toEqual([]);
  });

  it("checks a deformation's structure and volume", () => {
    const image = renderFigure(s);
    const rig = buildRig(image, fromAlpha(image), s);
    const result = deform(image, rig, shifted(20));
    const { outcomes } = registry.run("rendering", { stage: "rendering", result, baseArea: result.stats.coverageArea });
    expect(outcomes.find((outcome) => outcome.id === "solid-drawing/structure")?.passed).toBe(true);
    const shrunk = registry.run("rendering", { stage: "rendering", result, baseArea: result.stats.coverageArea * 2 });
    expect(shrunk.outcomes.find((outcome) => outcome.id === "solid-drawing/structure")?.passed).toBe(false);
    const prep = registry.run("frame-preparation", { stage: "frame-preparation", plan: result.plan });
    expect(prep.outcomes[0].passed).toBe(true);
  });

  it("flags a stabilizer that flattens the extremities' follow-through", () => {
    const pose = (x: number) => ({ keypoints: Array.from({ length: 133 }, (_, i) => (i === 9 ? [x, 500] : [100, 100]) as [number, number]), scores: new Array<number>(133).fill(0.9) });
    const raw = [0, 100, 200, 300].map(pose);
    const lagging = [0, 20, 60, 120].map(pose);
    const { outcomes } = registry.run("pose-planning", { stage: "pose-planning", index: 1, target: s, candidates: [], track: { raw, stabilized: lagging, fps: 9 } });
    expect(outcomes.find((outcome) => outcome.id === "follow-through/keep-overlap")?.passed).toBe(false);
    const faithful = registry.run("pose-planning", { stage: "pose-planning", index: 1, target: s, candidates: [], track: { raw, stabilized: raw, fps: 9 } });
    expect(faithful.outcomes.find((outcome) => outcome.id === "follow-through/keep-overlap")?.passed).toBe(true);
  });
});
