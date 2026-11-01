import { describe, expect, it } from "vitest";
import { decide } from "./decision";
import { fidelityCheck, fidelityScore, fidelityThresholds, judgeFidelity, type FidelityReport } from "./fidelity";

const report = (overrides: Partial<FidelityReport> = {}): FidelityReport => ({
  metrics: { pose: 98, limbs: 97, integrity: 96, proportions: 99, motion: 97, continuity: 96, identity: 94, silhouette: 60 },
  bones: [{ bone: "right forearm", screen: "left", error: 4, weight: 1, score: 1 }],
  limbs: [{ limb: "right arm", present: true, onGuide: 0.95, onInk: 0.9, score: 0.93 }],
  joints: [],
  fragments: [],
  mirrored: false,
  notes: [],
  ...overrides,
});

const bar = fidelityThresholds({});

describe("fidelity gate", () => {
  it("weights the measured metrics and never counts the silhouette", () => {
    const score = fidelityScore(report())!;
    expect(score).toBeGreaterThan(96);
    expect(fidelityScore(report({ metrics: { ...report().metrics, silhouette: 0 } }))).toBe(score);
    // Unmeasured metrics (frame 1 has no previous drawing) don't count against it.
    expect(fidelityScore(report({ metrics: { pose: 98, limbs: 98 } }))).toBe(98);
  });

  it("approves a faithful drawing", () => {
    const check = fidelityCheck(report(), bar);
    expect(check.passed).toBe(true);
    expect(decide([check]).decision).toBe("ACCEPTED");
  });

  it("rejects under the bar even with no floor broken", () => {
    const check = fidelityCheck(report({ metrics: { pose: 92, limbs: 93, integrity: 95 } }), bar);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("< 95 %");
    expect(decide([check]).decision).toBe("REJECTED");
  });

  it("rejects a mirrored or limbless drawing as critical, whatever its average", () => {
    const mirrored = fidelityCheck(report({ mirrored: true }), bar);
    expect(mirrored).toMatchObject({ passed: false, severity: "critical" });
    expect(mirrored.feedback).toContain("mirrored");
    const limbless = judgeFidelity(report({ limbs: [{ limb: "left arm", present: false, onGuide: 0, onInk: 0, score: 0 }] }), bar);
    expect(limbless).toMatchObject({ passed: false, critical: true });
    expect(limbless.feedback.join(" ")).toContain("left arm");
  });

  it("tells the next attempt which limb is off, on which side, without percentages", () => {
    const verdict = judgeFidelity(report({ bones: [{ bone: "left upper arm", screen: "right", error: 48, weight: 1, score: 0.2 }, { bone: "right shin", screen: "left", error: 3, weight: 1, score: 1, ratio: 1.4 }] }), bar);
    expect(verdict.passed).toBe(false);
    expect(verdict.feedback.join(" ")).toContain("upper arm on the RIGHT of the image points 48°");
    expect(verdict.feedback.join(" ")).toContain("shin on the LEFT of the image is drawn 1.4 times too long");
    // swapFramePrompt drops feedback sentences with percentages.
    expect(verdict.feedback.join(" ")).not.toMatch(/\d\s?%/);
  });

  it("flags a jump from the previous frame and loose fragments", () => {
    const verdict = judgeFidelity(report({ metrics: { ...report().metrics, continuity: 60, motion: 50 }, fragments: [{ box: [1, 2, 3, 4], area: 90, share: 0.01 }] }), bar);
    expect(verdict.failures.join("; ")).toMatch(/continuity.*motion.*|motion.*continuity/s);
    expect(verdict.failures.join("; ")).toContain("fragment");
  });

  it("reads its bar from the environment", () => {
    expect(fidelityThresholds({ FOCUS_ROTOSCOPE_FIDELITY_MIN: "90" }).overall).toBe(90);
    expect(fidelityThresholds({ FOCUS_ROTOSCOPE_FIDELITY_MIN: "nope" }).overall).toBe(95);
  });

  it("is inconclusive when nothing could be measured", () => {
    const check = fidelityCheck(report({ metrics: {}, notes: ["the guide has no torso"] }), bar);
    expect(check.status).toBe("inconclusive");
    expect(decide([check]).decision).toBe("INCONCLUSIVE");
  });
});
