import { EFFECTS } from "../../shared/pipeline";
import type { EffectId, Suggestions } from "../../shared/schemas";

// Inline completion for the instruction box. Pure and local: no request per
// keystroke. Candidates are the clip's AI ideas, phrases built from the
// subjects in view, then the static examples; the picked effect comes first.

const TEMPLATES: Record<EffectId, readonly string[]> = {
  "reality-shift": ["Keep the {s} in color", "Keep the {s} sharp and blur the background", "Blur everything but the {s}"],
  "break-the-frame": ["Make the {s} step out of the frame", "Let the {s} break the frame"],
  "motion-echo": ["Add motion trails to the {s}", "Give the {s} a cinematic echo"],
  "time-freeze": ["Freeze time when the {s} jumps", "Freeze the {s} mid-air with echoes"],
};

const ORDER: readonly EffectId[] = ["reality-shift", "break-the-frame", "motion-echo"];

/** Strips a leading article so "two people" reads well after "the". */
function bare(subject: string): string {
  return subject.replace(/^(the|a|an)\s+/i, "");
}

export function completionCandidates(effect: EffectId, suggestions: Suggestions | null): string[] {
  const families = [effect, ...ORDER.filter((id) => id !== effect)];
  const subjects = suggestions?.subjects ?? [];
  const list: string[] = [];
  for (const family of families) {
    list.push(...(suggestions?.ideas[family] ?? []));
    for (const subject of subjects) for (const template of TEMPLATES[family]) list.push(template.replace("{s}", bare(subject)));
    list.push(...(EFFECTS.find((entry) => entry.id === family)?.examples ?? []));
  }
  return [...new Set(list)];
}

/**
 * The text to append after `text`, or null. A whole candidate that starts
 * with what was typed wins; otherwise the last word(s) may complete a subject
 * ("…but the tw" → "o people").
 */
export function completionFor(text: string, candidates: readonly string[], subjects: readonly string[]): string | null {
  if (!text.trim() || /\s{2,}$|\n$/.test(text)) return null;
  const typed = text.trimStart().toLowerCase();
  for (const candidate of candidates) {
    if (candidate.length > typed.length && candidate.toLowerCase().startsWith(typed)) return candidate.slice(typed.length);
  }
  const words = text.split(/\s+/);
  // Try the longest tail first, so "red c" can complete "red car".
  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const tail = words.slice(-take).join(" ").toLowerCase();
    if (!tail) continue;
    for (const subject of subjects.map(bare)) {
      if (subject.length > tail.length && subject.toLowerCase().startsWith(tail)) return subject.slice(tail.length);
    }
  }
  return null;
}
