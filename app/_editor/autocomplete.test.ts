import { describe, expect, it } from "vitest";
import { completionCandidates, completionFor } from "./autocomplete";
import { parseSuggestions } from "../../server/ai/suggest";

const suggestions = parseSuggestions(
  JSON.stringify({
    subjects: ["two people", "the man in black suit", "x".repeat(60)],
    ideas: {
      "reality-shift": ["Keep both people sharp, blur the background.", "Keep both people sharp, blur the background"],
      "break-the-frame": ["Make the man step out of the frame"],
      "motion-echo": [42, "Add trails to the walking man"],
    },
  }),
);

describe("parseSuggestions", () => {
  it("cleans, dedupes and bounds what the model returns", () => {
    expect(suggestions.subjects).toEqual(["two people", "the man in black suit"]);
    expect(suggestions.ideas["reality-shift"]).toEqual(["Keep both people sharp, blur the background"]);
    expect(suggestions.ideas["motion-echo"]).toEqual(["Add trails to the walking man"]);
  });

  it("returns empty suggestions for unreadable output", () => {
    expect(parseSuggestions("not json").subjects).toEqual([]);
  });
});

describe("completionFor", () => {
  const candidates = completionCandidates("reality-shift", suggestions);

  it("completes a whole idea from its start, picked effect first", () => {
    expect(completionFor("keep b", candidates, suggestions.subjects)).toBe("oth people sharp, blur the background");
    expect(completionFor("Make the m", candidates, suggestions.subjects)).toBe("an step out of the frame");
  });

  it("completes a subject at the end of free text", () => {
    expect(completionFor("I want the tw", candidates, suggestions.subjects)).toBe("o people");
  });

  it("stays quiet on empty text, a new line, or nothing to add", () => {
    expect(completionFor("", candidates, suggestions.subjects)).toBeNull();
    expect(completionFor("keep\n", candidates, suggestions.subjects)).toBeNull();
    expect(completionFor("zzz", candidates, suggestions.subjects)).toBeNull();
  });

  it("works without AI suggestions, from the static examples", () => {
    expect(completionFor("Blur every", completionCandidates("reality-shift", null), [])).toBe("thing but the dog");
  });
});
