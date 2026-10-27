import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { SuggestionsSchema, type Suggestions, type VideoAsset } from "../../shared/schemas";
import { AppError } from "../errors";
import { guardConfig } from "../guard";
import { VIDEO_FILES, videoDir } from "../storage";
import { metaClient, metaError, plannerLimiter, readMetaConfig, withRetry } from "./meta";
import { recordUsage } from "./usage";

// Composer suggestions: one Muse Spark look at the first frame per clip,
// cached next to the video. Optional by design: when AI is off or the call
// fails, the editor keeps its static examples.

const EMPTY: Suggestions = { subjects: [], ideas: { "reality-shift": [], "break-the-frame": [], "motion-echo": [], "time-freeze": [] } };

const ideaList = { type: "array", items: { type: "string" } } as const;

export const SUGGESTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subjects", "ideas"],
  properties: {
    subjects: { type: "array", items: { type: "string" } },
    ideas: {
      type: "object",
      additionalProperties: false,
      required: ["reality-shift", "break-the-frame", "motion-echo"],
      properties: { "reality-shift": ideaList, "break-the-frame": ideaList, "motion-echo": ideaList },
    },
  },
} as const;

export const SUGGEST_INSTRUCTIONS = `You help a user of Focus, a video editor, write their first instruction. You see the first frame of their short clip.

Return JSON:
- subjects: up to 4 visible subjects worth isolating, as short English noun phrases a segmentation model can find (1–3 words: "man in black suit", "dog", "red car"). Group identical subjects in one plural phrase when there are several ("two people").
- ideas: for each effect, 2 or 3 short English instructions (at most 9 words) that name subjects from this frame:
  - "reality-shift": keep subjects in color with a black-and-white background, or keep them sharp with a blurred background. When several people are visible, include one idea that keeps all of them ("Keep both people sharp, blur the background").
  - "break-the-frame": the subject steps out of an inner frame.
  - "motion-echo": motion trails behind a moving subject.
Imperative voice, no quotes, no trailing period.`;

/** Pure: raw model text to clean suggestions; anything malformed becomes empty. */
export function parseSuggestions(text: string): Suggestions {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY;
  }
  const clean = (list: unknown, max: number) =>
    Array.isArray(list)
      ? [...new Set(list.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().replace(/[.。]+$/, "")))]
          .filter((entry) => entry.length >= 3 && entry.length <= 90)
          .slice(0, max)
      : [];
  const value = raw as { subjects?: unknown; ideas?: Record<string, unknown> };
  const parsed = SuggestionsSchema.safeParse({
    subjects: clean(value?.subjects, 6).filter((entry) => entry.length <= 40),
    ideas: {
      "reality-shift": clean(value?.ideas?.["reality-shift"], 4),
      "break-the-frame": clean(value?.ideas?.["break-the-frame"], 4),
      "motion-echo": clean(value?.ideas?.["motion-echo"], 4),
    },
  });
  return parsed.success ? parsed.data : EMPTY;
}

const inflight = ((globalThis as { __focusSuggest?: Map<string, Promise<Suggestions>> }).__focusSuggest ??= new Map());

export async function suggestionsFor(video: VideoAsset): Promise<Suggestions> {
  const file = path.join(videoDir(video.id), "suggestions.json");
  const cached = await readFile(file, "utf8").catch(() => null);
  if (cached) {
    const parsed = SuggestionsSchema.safeParse(JSON.parse(cached));
    if (parsed.success) return parsed.data;
  }
  const config = readMetaConfig();
  if (!config || guardConfig().aiDisabled) return EMPTY;

  let pending = inflight.get(video.id);
  if (!pending) {
    pending = (async () => {
      const poster = `data:image/jpeg;base64,${(await readFile(path.join(videoDir(video.id), VIDEO_FILES.poster))).toString("base64")}`;
      const started = Date.now();
      try {
        const response = await plannerLimiter.run(() =>
          withRetry(() =>
            metaClient(config).responses.create({
              model: config.plannerModel,
              instructions: SUGGEST_INSTRUCTIONS,
              reasoning: { effort: "low" },
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    { type: "input_text", text: `Clip: ${video.normalized.width}x${video.normalized.height}, ${video.normalized.durationSeconds.toFixed(1)} s` },
                    { type: "input_image", image_url: poster, detail: "low" },
                  ],
                },
              ],
              text: { format: { type: "json_schema", name: "suggestions", strict: true, schema: SUGGESTIONS_JSON_SCHEMA as unknown as Record<string, unknown> } },
            }),
          ),
        );
        await recordUsage({
          model: config.plannerModel,
          kind: "suggest",
          cached: false,
          ok: true,
          videoId: video.id,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          durationMs: Date.now() - started,
        });
        if (response.status !== "completed" || !response.output_text) throw new AppError("planner_incomplete", 502, "Suggestions incomplete.");
        const suggestions = parseSuggestions(response.output_text);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(suggestions));
        await rename(`${file}.tmp`, file);
        return suggestions;
      } catch (error) {
        if (!(error instanceof AppError)) {
          await recordUsage({ model: config.plannerModel, kind: "suggest", cached: false, ok: false, videoId: video.id, error: String(error), durationMs: Date.now() - started });
        }
        throw metaError(error, "suggestions");
      }
    })().finally(() => inflight.delete(video.id));
    inflight.set(video.id, pending);
  }
  return pending;
}
