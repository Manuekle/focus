import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { META_DEFAULTS, type MetaConfig } from "../ai/meta";
import { blocked, continuityGuardrail, guardPrompt, museOnly, PROMPT_CLAUSES, pythonProblem, sourceGuardrails } from "./guardrails";
import type { Pose } from "./pose-match";
import type { Manifest } from "./run-state";

const config = (overrides: Partial<MetaConfig> = {}): MetaConfig => ({ apiKey: "k", ...META_DEFAULTS, ...overrides } as MetaConfig);

const body = (missing: readonly number[] = []): Pose => ({
  keypoints: Array.from({ length: 17 }, (_, i): readonly [number | null, number | null] => (missing.includes(i) ? [null, null] : [100 + i, 200 + i])),
  scores: Array.from({ length: 17 }, (_, i) => (missing.includes(i) ? 0 : 0.9)),
});

const manifest = (frames: Manifest["frames"]): Manifest => ({
  version: 1, createdAt: "", video: "v.mp4", fps: 9, start: 0, seconds: 2, crop: null,
  character: { file: "character.png", sha256: "x" }, maxAttempts: 3, frames,
});

describe("preflight", () => {
  it("accepts the Muse models and refuses any other", () => {
    expect(museOnly(config()).passed).toBe(true);
    const other = museOnly(config({ imageModel: "flux-pro" }));
    expect(other.passed).toBe(false);
    expect(other.blocking).toBe(true);
    expect(other.detail).toContain("imageModel");
  });

  it("names the missing interpreter a venv still links to", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "focus-venv-"));
    mkdirSync(path.join(dir, "bin"));
    const gone = path.join(dir, "uv", "cpython-3.12", "bin", "python3.12");
    symlinkSync(gone, path.join(dir, "bin", "python"));
    expect(pythonProblem(path.join(dir, "bin", "python"))).toContain(gone);
    expect(pythonProblem(path.join(dir, "bin", "nothing"))).toContain("missing");
    expect(pythonProblem(process.execPath)).toBeNull();
  });
});

describe("input guardrails", () => {
  it("blocks a frame with no body and warns on unseen limbs", () => {
    expect(blocked(sourceGuardrails(undefined))?.name).toBe("source-pose");
    expect(blocked(sourceGuardrails(body([5, 6, 11, 12])))?.name).toBe("source-pose");
    const partial = sourceGuardrails(body([9]));
    expect(blocked(partial)).toBeNull();
    expect(partial.find((guardrail) => guardrail.name === "source-limbs")).toMatchObject({ passed: false, detail: expect.stringContaining("left arm") });
  });

  it("shows only the frame right before, approved and trusted", () => {
    const passedFidelity = { name: "fidelity", passed: true, detail: "97 %", score: 97 };
    const failedFidelity = { name: "fidelity", passed: false, detail: "80 %", score: 80 };
    const approved = (index: number, checks: object[], manual = false) => ({
      index, source: `source/${index}.png`, status: "approved" as const,
      attempts: [{ attempt: 1, at: "", file: `attempts/${index}.png`, passed: true, checks: checks as never }],
      approved: { file: `frames/${index}.png`, sha256: "h", attempt: 1, ...(manual ? { manual } : {}) },
    });
    expect(continuityGuardrail(manifest([]), 1).frame).toBeNull();
    expect(continuityGuardrail(manifest([approved(1, [passedFidelity])]), 2).frame?.index).toBe(1);
    expect(continuityGuardrail(manifest([approved(1, [failedFidelity])]), 2).frame).toBeNull();
    expect(continuityGuardrail(manifest([approved(1, [failedFidelity], true)]), 2).frame?.index).toBe(1);
    expect(continuityGuardrail(manifest([{ index: 1, source: "s", status: "failed", attempts: [] }]), 2).frame).toBeNull();
  });
});

describe("prompt guardrails", () => {
  it("adds back every clause a written prompt dropped, and only those", () => {
    const { prompt, guardrails } = guardPrompt("Edit Image 1: replace the person with the character of Image 2. Never mirrored.", 3);
    expect(prompt).toContain("GUARDRAILS");
    expect(prompt).toContain("exactly two arms");
    expect(prompt).toContain("magenta");
    expect(prompt.match(/never mirrored/gi)).toHaveLength(1);
    expect(guardrails.find((guardrail) => guardrail.name === "prompt-sides")?.detail).toBe("present");
    expect(blocked(guardrails)).toBeNull();
  });

  it("leaves a complete prompt as it is", () => {
    const full = PROMPT_CLAUSES.map((clause) => clause.text).join("\n");
    expect(guardPrompt(full, 2).prompt).toBe(full);
  });

  it("blocks a prompt naming an image that isn't sent", () => {
    expect(blocked(guardPrompt("Follow Image 4 exactly.", 3).guardrails)?.name).toBe("prompt-images");
  });
});
