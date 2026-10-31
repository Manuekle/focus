import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { layoutRun } from "./pipeline";

// The sheet's hair top rule is fixed per run with its layout: a run laid out before the column rule keeps
// the old top (its later frames must be placed like its approved ones); a new run records the new rule.
// Local only: the rebuilt wave run lives in debug_runs/ (scripts/audit/rebuild-wave-run.ts).

const run = path.join(process.cwd(), "debug_runs/runs/wave");

describe.skipIf(!existsSync(path.join(run, "manifest.json")))("layout and the hair top rule", () => {
  it("a new run records the column rule; an old layout keeps the sheet's topmost pixel", async () => {
    const work = await mkdtemp(path.join(tmpdir(), "focus-layout-"));
    try {
      const fresh = path.join(work, "fresh");
      await cp(run, fresh, { recursive: true, filter: (from) => !from.endsWith("layout.json") });
      const created = await layoutRun(fresh);
      // A new run also stands the character on the video person's own figure, measured once and kept.
      expect(JSON.parse(await readFile(path.join(fresh, "layout.json"), "utf8"))).toMatchObject({ hairTop: "column", size: "person", ratio: 1, person: { method: expect.any(String) } });

      const old = path.join(work, "old");
      await cp(run, old, { recursive: true });
      const kept = JSON.parse(await readFile(path.join(old, "layout.json"), "utf8")) as Record<string, unknown>;
      expect(kept.hairTop).toBeUndefined();
      const before = await layoutRun(old);
      // Same frames, same sheet: only the head measure differs, and the old run keeps the taller one.
      expect(before.sheet.headHeight).toBeGreaterThan(created.sheet.headHeight);
      expect(before.fit).toEqual({ scale: kept.scale, x: kept.x, y: kept.y });
      // ...and its target lines: the guide's skeleton with the sheet's head and feet, until it is refitted.
      expect(before.person).toBeNull();
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
