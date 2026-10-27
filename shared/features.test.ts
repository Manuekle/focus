import { afterEach, describe, expect, it, vi } from "vitest";
import { effectEnabled, temporalEffectsEnabled } from "./features";
import { availableEffects } from "./pipeline";

afterEach(() => vi.unstubAllEnvs());

describe("temporal release flag", () => {
  const stable = ["reality-shift", "break-the-frame", "motion-echo"] as const;

  it.each([undefined, "", "false", "FALSE", "TRUE", "1", "true ", " true"])("keeps the stable catalog for %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", value);
    expect(temporalEffectsEnabled()).toBe(false);
    expect(effectEnabled("time-freeze")).toBe(false);
    expect(availableEffects().map((effect) => effect.id)).toEqual(stable);
    stable.forEach((effect) => expect(effectEnabled(effect)).toBe(true));
  });

  it("adds Time Freeze only for the explicit true value, preserving the stable effects", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", "true");
    expect(temporalEffectsEnabled()).toBe(true);
    expect(availableEffects().map((effect) => effect.id)).toEqual([...stable, "time-freeze"]);
    stable.forEach((effect) => expect(effectEnabled(effect)).toBe(true));
  });
});
