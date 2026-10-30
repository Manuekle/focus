import { describe, expect, it } from "vitest";
import { learn, lessonLines, mistakes, RECENT_REJECTIONS } from "./lessons";
import type { Check, FrameState } from "./run-state";

let clock = 0;
const attempt = (passed: boolean, checks: Check[]) => ({ attempt: ++clock, at: new Date(clock * 1000).toISOString(), file: "", passed, checks });
const frame = (index: number, attempts: FrameState["attempts"]): FrameState => ({ index, source: "", status: "pending", attempts });
const failed = (name: string, detail: string, feedback?: string): Check => ({ name, passed: false, detail, ...(feedback ? { feedback } : {}) });

describe("mistakes", () => {
  it("turns a failed check into a general rule, not a frame's coordinates", () => {
    expect(mistakes(failed("pose", "MIRRORED, 4 bones, mean 1.0°, worst left thigh 2°"))[0].key).toBe("pose:mirrored");
    expect(mistakes(failed("scale", "hair 0.9/2.8, soles 11.6/11.5 (head -23 %, feet +1 %, centre +0 %)"))[0].key).toBe("scale:big");
    expect(mistakes(failed("proportions", "8 limbs measured, worst right-of-image upper arm +58 %, head -14 %")).map((m) => m.key)).toEqual(["long:upper arm"]);
  });

  it("names the reviewer's sides as the viewer sees them, one lesson per arm and hand", () => {
    const found = mistakes(failed("review", "right arm (upper arm and forearm): video bent; drawing raised | right hand: video at chest; drawing high | legs and feet: video together; drawing apart"));
    expect(found.map((m) => m.key)).toEqual(["review:arm:screen-left", "review:legs"]);
    expect(found[0].rule).toMatch(/^The arm and hand on the LEFT of the image/);
  });

  it("ignores checks that passed", () => {
    expect(mistakes({ name: "scale", passed: true, detail: "fine" })).toEqual([]);
  });
});

describe("learn", () => {
  it("counts a mistake across frames, most frequent first", () => {
    const lessons = learn([
      frame(1, [attempt(false, [failed("scale", "(head -20 %)")]), attempt(true, [])]),
      frame(2, [attempt(false, [failed("scale", "(head -18 %)"), failed("pose", "MIRRORED, 4 bones")])]),
    ]);
    expect(lessons.map((lesson) => [lesson.key, lesson.count, lesson.frames])).toEqual([["scale:big", 2, [1, 2]], ["pose:mirrored", 1, [2]]]);
  });

  it("forgets mistakes older than the latest rejections", () => {
    const old = frame(1, [attempt(false, [failed("pose", "MIRRORED, 4 bones")])]);
    const recent = Array.from({ length: RECENT_REJECTIONS }, (_, i) => frame(i + 2, [attempt(false, [failed("scale", "(head -20 %)")])]));
    expect(learn([old, ...recent]).map((lesson) => lesson.key)).toEqual(["scale:big"]);
  });
});

describe("lessonLines", () => {
  const frames = [
    frame(1, [attempt(false, [failed("scale", "(head -20 %)")]), attempt(true, [])]),
    frame(2, [attempt(false, [failed("review", "legs and feet: video together; drawing apart", "Bring the feet together.")])]),
  ];

  it("puts the run's lessons and this frame's last rejection into the prompt", () => {
    const lines = lessonLines(frames, 2);
    expect(lines[0]).toMatch(/^Mistakes already made in this animation/);
    expect(lines[0]).toMatch(/too big/);
    expect(lines[1]).toBe("An earlier drawing of this same frame was rejected for: Bring the feet together.");
  });

  it("leaves the frame's own rejection out when this run already passes its feedback", () => {
    expect(lessonLines(frames, 2, false)).toHaveLength(1);
  });

  it("says nothing before the first rejection", () => {
    expect(lessonLines([frame(1, [])], 1)).toEqual([]);
  });
});
