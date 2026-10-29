import sharp from "sharp";
import {
  FrameReviewSchema,
  ReviewIssueCodeSchema,
  actionSpec,
  type AnimationAction,
  type CharacterAnalysis,
  type FrameReview,
  type Phase,
  type FrameWarning,
} from "../../shared/flipbook";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";
import type { Measure } from "./frame-alignment";
import { stationaryColorsDiffer, type BodyColors } from "./appearance-consistency";

// Frame quality control. The automatic checks measure things pixels can
// show — framing, scale drift, color drift, flat background, silhouettes
// that barely changed, a stride that isn't there — and flag them. They never
// certify anatomy or identity: that is what the contact sheet and the
// optional Muse Spark review are for, and the review is labeled as an opinion.

export type QcEntry = {
  readonly frameId: string;
  readonly label: string;
  readonly phase: string;
  readonly measure: Measure;
  readonly scale: number;
  /** The pose's planned height on the bob chart (0 = standing); a crouch is shorter on purpose. */
  readonly relativeRootY?: number;
  /** Aligned sprite PNG (cell size). */
  readonly sprite: Buffer;
  /** Interior torso colors, only for a planned gesture whose torso stays still. */
  readonly stationaryColors?: BodyColors;
};

export type QcResult = { readonly warnings: FrameWarning[]; readonly relativeScale: number; readonly colorDistance: number | null };

const GRID = 96;

async function silhouette(sprite: Buffer): Promise<{ mask: Uint8Array; comX: number }> {
  const { data, info } = await sharp(sprite).ensureAlpha().extractChannel(3).resize(GRID, GRID, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(GRID * GRID);
  let sum = 0, count = 0;
  for (let index = 0; index < mask.length; index++) {
    if (data[index * info.channels] >= 128) { mask[index] = 1; sum += index % GRID; count++; }
  }
  return { mask, comX: count ? sum / count / GRID : 0.5 };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0, either = 0;
  for (let index = 0; index < a.length; index++) {
    if (a[index] || b[index]) either++;
    if (a[index] && b[index]) both++;
  }
  return either ? both / either : 1;
}

export function histogramDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += Math.abs(a[index] - (b[index] ?? 0));
  return Math.min(1, sum / 2);
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Checks every ready frame, in playback order (the loop's wrap counts as a neighbor). */
export async function checkFrames(entries: readonly QcEntry[], referenceHistogram: readonly number[] | null, action: AnimationAction = "walk", view: string = "side", finite = false, stationaryReference?: BodyColors): Promise<Map<string, QcResult>> {
  const spec = actionSpec(action);
  const stride = !finite && view === "side" ? spec.stride : null;
  // A scene has several figures that move about a fixed frame: neither a second figure nor a shifting center of mass is a fault.
  const group = action === "ensemble";
  const results = new Map<string, QcResult>();
  if (!entries.length) return results;
  const shapes = await Promise.all(entries.map((entry) => silhouette(entry.sprite)));
  // Every drawing is framed alike, so its scale carries the pose's planned height (a crouch is drawn
  // shorter on purpose). Divided out, what is left is drift in how big the character was drawn.
  const drift = entries.map((entry) => entry.scale / (1 + (entry.relativeRootY ?? 0)));
  const medianScale = median(drift);
  const medianCom = median(shapes.map((shape) => shape.comX));
  const passingSpans = entries.filter((entry) => stride?.passing.includes(entry.phase as Phase)).map((entry) => entry.measure.lowerSpan * entry.scale);
  const passingSpan = passingSpans.length ? median(passingSpans) : null;

  entries.forEach((entry, index) => {
    const warnings: FrameWarning[] = [];
    const { measure } = entry;
    if (measure.touchesEdge) warnings.push({ code: "subject_cropped", message: "Part of the character touches the drawing’s edge and may be cut off." });
    const relativeScale = medianScale ? drift[index] / medianScale : 1;
    if (Math.abs(relativeScale - 1) > 0.15) {
      warnings.push({ code: "scale_corrected", message: `Drawn ${relativeScale > 1 ? "smaller" : "larger"} than the others; resized by ${Math.round(Math.abs(relativeScale - 1) * 100)}% to match. Check the proportions.` });
    }
    const colorDistance = referenceHistogram ? histogramDistance(measure.histogram, referenceHistogram) : null;
    const localColorShift = entry.stationaryColors && stationaryReference && stationaryColorsDiffer(entry.stationaryColors, stationaryReference);
    if ((colorDistance !== null && colorDistance > 0.38) || localColorShift) warnings.push({ code: "color_shift", message: "Its colors differ noticeably from the reference character." });
    if (measure.method !== "alpha" && measure.backgroundUniformity < 0.85) warnings.push({ code: "background_not_plain", message: "Muse Image drew a background here; the cut-out may include part of it." });
    if (measure.method === "key") warnings.push({ code: "key_extraction", message: "Cut out by its flat background color (SAM found no match). Check the edges." });
    if (measure.multiple && !group) warnings.push({ code: "multiple_subjects", message: "More than one figure was found in this drawing; the largest was kept." });
    const previous = (index - 1 + entries.length) % entries.length;
    if (!finite && !spec.subtle && entries.length > 1 && previous !== index && iou(shapes[index].mask, shapes[previous].mask) > 0.95) {
      warnings.push({ code: "near_duplicate", message: `Almost identical to the frame before it (“${entries[previous].label}”). The pose may not have changed.` });
    }
    if (stride?.contact.includes(entry.phase as Phase) && passingSpan !== null && measure.lowerSpan * entry.scale < passingSpan * 1.25) {
      warnings.push({ code: "stride_unclear", message: "The feet are not clearly apart, as a contact pose needs." });
    }
    // Center of mass as a share of the cell width; the torso is registered, so a big shift is the body leaning or sliding.
    if (!finite && !group && Math.abs(shapes[index].comX - medianCom) > 0.08) {
      warnings.push({ code: "body_offset", message: "The body’s weight sits off-center compared with the other frames." });
    }
    results.set(entry.frameId, { warnings: warnings.slice(0, 12), relativeScale, colorDistance });
  });
  return results;
}

// ── Contact sheet ──────────────────────────────────────────────────────────

/** All drawings in playback order on one sheet, 4 per row, frame 1 at the top left. */
export async function contactSheet(sprites: readonly Buffer[], cell: { width: number; height: number }, options: { scale?: number; background?: string } = {}): Promise<Buffer> {
  const scale = options.scale ?? 0.5;
  const width = Math.round(cell.width * scale);
  const height = Math.round(cell.height * scale);
  const columns = Math.min(4, sprites.length);
  const rows = Math.ceil(sprites.length / columns);
  const gap = 8;
  const tiles = await Promise.all(sprites.map((sprite) => sharp(sprite).resize(width, height, { fit: "fill" }).png().toBuffer()));
  return sharp({ create: { width: columns * width + (columns + 1) * gap, height: rows * height + (rows + 1) * gap, channels: 4, background: options.background ?? "#d9d9d9" } })
    .composite(tiles.map((input, index) => ({ input, left: gap + (index % columns) * (width + gap), top: gap + Math.floor(index / columns) * (height + gap) })))
    .flatten({ background: options.background ?? "#d9d9d9" })
    .png()
    .toBuffer();
}

// ── Muse Spark review ──────────────────────────────────────────────────────

const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "recognizableWalk", "frames"],
  properties: {
    summary: { type: "string" },
    recognizableWalk: { type: "boolean" },
    frames: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["frame", "ok", "issues"],
        properties: {
          frame: { type: "integer" },
          ok: { type: "boolean" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "note"],
              properties: { code: { type: "string", enum: ReviewIssueCodeSchema.options }, note: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

export type ReviewResult = { summary: string; recognizableWalk: boolean; frames: Map<number, FrameReview> };

export async function reviewFrames(input: {
  readonly reference: Buffer;
  readonly sheet: Buffer;
  readonly labels: readonly string[];
  readonly analysis: CharacterAnalysis | null;
  readonly direction: string;
  readonly action?: AnimationAction;
  readonly flipbookId: string;
  readonly finite?: boolean;
}): Promise<ReviewResult> {
  const spec = actionSpec(input.action);
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  const instructions = `You review the drawings of a hand-drawn ${spec.label} for Focus Flipbook. Image 1 is the character reference. Image 2 is a contact sheet of ${input.labels.length} drawings in playback order, read left to right, top to bottom; frame 1 is at the top left. ${input.finite ? "This is a time window of one finite continuous action. Its last drawing does NOT loop to its first; do not expect a complete cycle in this window. Small differences at 24 drawings/s are intentional and do not indicate duplicates. Judge visible anatomy, identity and local motion continuity." : "The cycle loops from the last frame back to frame 1."}
Frames: ${input.labels.map((label, index) => `${index + 1} = ${label}`).join(", ")}. Camera and heading in every frame: ${input.direction}.
For each frame, report only problems you can actually see: wrong_facing, identity_change (outfit, hair, colors or accessories differ from the reference), missing_limb, extra_limb, wrong_pose (does not match its phase), cropped, style_change, same_as_neighbor (pose barely differs from an adjacent frame), other. Write every note and the summary in English. Keep each note under 20 words. ok=true when a frame has no visible problem.
recognizableWalk: true when playing the frames in order would read as a ${spec.label}. summary: one or two sentences for the animator. Be honest; do not praise.`;
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(() =>
        client.responses.create({
          model: config.plannerModel,
          instructions,
          reasoning: { effort: "low" },
          input: [{
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: input.analysis ? `Character: ${input.analysis.subject}. ${input.analysis.clothing}. ${input.analysis.hair}.` : "Character: see Image 1." },
              { type: "input_image", image_url: `data:image/png;base64,${input.reference.toString("base64")}`, detail: "high" },
              { type: "input_image", image_url: `data:image/png;base64,${input.sheet.toString("base64")}`, detail: "high" },
            ],
          }],
          text: { format: { type: "json_schema", name: "walk_review", strict: true, schema: REVIEW_JSON_SCHEMA } },
        }),
      ),
    );
    await recordUsage({ model: config.plannerModel, kind: "flipbook_review", cached: false, ok: true, flipbookId: input.flipbookId, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) throw new AppError("review_incomplete", 502, "Muse Spark didn’t finish the review. Try again.");
    return parseReview(response.output_text, input.labels.length);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "flipbook_review", cached: false, ok: false, flipbookId: input.flipbookId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "frame review");
  }
}

export function parseReview(text: string, count: number): ReviewResult {
  let raw: { summary?: unknown; recognizableWalk?: unknown; frames?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("review_invalid_output", 502, "Muse Spark returned an unreadable review. Try again.");
  }
  const frames = new Map<number, FrameReview>();
  for (const entry of Array.isArray(raw.frames) ? raw.frames : []) {
    const frame = Number((entry as { frame?: unknown }).frame);
    if (!Number.isInteger(frame) || frame < 1 || frame > count || frames.has(frame - 1)) continue;
    const issues = Array.isArray((entry as { issues?: unknown }).issues) ? (entry as { issues: { code?: unknown; note?: unknown }[] }).issues : [];
    const parsed = FrameReviewSchema.safeParse({
      ok: Boolean((entry as { ok?: unknown }).ok) && issues.length === 0,
      issues: issues
        .filter((issue) => ReviewIssueCodeSchema.safeParse(issue.code).success)
        .map((issue) => ({ code: issue.code, note: String(issue.note ?? "").slice(0, 200) }))
        .slice(0, 6),
    });
    if (parsed.success) frames.set(frame - 1, parsed.data);
  }
  return {
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 400) : "",
    recognizableWalk: raw.recognizableWalk === true,
    frames,
  };
}
