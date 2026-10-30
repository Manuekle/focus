import { z } from "zod";
import { SPEED_BOUNDS, WALK_FRAME_COUNT, actionSpec, orderedFrames, type Flipbook, type FlipbookFrame } from "../../shared/flipbook";
import {
  CHAT_HISTORY_LIMIT,
  POSE_DESCRIPTION_MAX,
  FlipbookProposalSchema,
  type ChatPlayback,
  type ChatTurn,
  type FlipbookProposal,
  type PlaybackPatch,
  type PoseChange,
  type SkippedFrame,
} from "../../shared/flipbook-chat";
import { AppError } from "../errors";
import { metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { nullable } from "../ai/finish-schema";
import { recordUsage } from "../ai/usage";
import { storeProposal } from "./proposals";

// The Flipbook chat. Muse Spark reads the plan (the eight poses, in playback
// order) and one sentence from the person, and answers with a short reply
// plus a typed proposal: poses whose instruction changes, and/or playback
// settings. It never draws and never executes anything. The route returns the
// proposal with its cost in drawings; only an explicit apply redraws.

/** Replaceable in tests so no paid request ever runs there. */
export const chatServices = {
  complete: completeWithMuseSpark,
};

export function chatJsonSchema(positions?: readonly number[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reply", "action", "poses", "playback"],
    properties: {
      reply: { type: "string" },
      action: { type: "string", enum: ["propose", "none"] },
      poses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["position", "summary", "description"],
          properties: {
            position: { type: "integer", enum: positions ?? Array.from({ length: WALK_FRAME_COUNT }, (_, index) => index + 1) },
            summary: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      playback: {
        type: "object",
        additionalProperties: false,
        required: ["drawingFps", "speed", "durationSeconds", "motion"],
        properties: {
          drawingFps: nullable({ type: "integer", enum: [4, 8, 12] }),
          speed: nullable({ type: "number" }),
          durationSeconds: nullable({ type: "integer", enum: [2, 4, 6, 20] }),
          motion: nullable({ type: "string", enum: ["in_place", "across"] }),
        },
      },
    },
  };
}

export function chatInstructions(flipbook: Pick<Flipbook, "plan">): string {
  if (flipbook.plan?.mode === "sequence") return `You edit a finite continuous animation of ${flipbook.plan.durationSeconds} seconds at ${flipbook.plan.drawingFps} drawings/s. Return a proposed change, never execute or draw. You see one window of the full timeline; position numbers are ABSOLUTE frame numbers and timestamps are seconds. Only propose edits to positions explicitly shown in this window, and only when the person's request applies there. Keep neighboring movement continuous, camera and staging fixed, identity unchanged. Describe body movement only, never clothing or appearance. Protect approved frames. The action does not loop back to its first pose. For duration, density, audio, a different character or a reference video, explain the corresponding studio controls and return no playback changes. Return reply (brief English), action propose or none, poses with absolute position, summary and complete English description, and playback with all fields null. Greeting or informational question: no changed poses. No costs in the reply.`;
  const spec = actionSpec(flipbook.plan?.action);
  return `You are the animation assistant inside Focus Flipbook. The person already has a ${spec.label} of one character: eight hand-drawn frames that loop forever, made by a drawing model from a short written description of each pose. They tell you in a chat what they want different. You never draw and never execute anything; you return a proposal as JSON, and the person approves it before anything is redrawn.

What you can change:
1. Poses. Each of the eight frames is drawn from its description. To change a frame, return that frame in "poses" with its position (1 to 8, as numbered) and a complete NEW description. Each changed frame costs one paid drawing, so change only the frames the request really needs: "wave with the other hand" changes every frame where the hand is raised; "change frame 4 so the arm is higher" changes frame 4 only; a mood or style request ("happier", "more energetic", "smaller movement") changes the frames where that shows, usually most of them.
2. Playback (free, no redraw), in "playback" (null for everything that should stay):
   - drawingFps 4 (a relaxed two-second dance cycle), 8 or 12 (faster cycles). This sets key-pose pace; in-betweens control smoothness.
   - speed 0.5–1.5: how far a travelling cycle moves per stride (1 keeps the feet planted). Only meaningful when the motion travels.
   - durationSeconds 2, 4, 6 or 20: how long the clip is. Every length is a whole number of cycles.
   - motion "in_place" or "across" (the cycle carried across the stage; only for actions that travel).
Looping is always on and cannot be turned off.

How to write a pose description: in English, 1–3 concrete sentences about the body in that drawing (which limbs, where, how bent, where the hands are) — the same kind of text as the current description. Keep what the request does not change: the camera view, which way the character faces, the arm or leg that was already used, the feet staying on the ground line, the loop (frame 8 must lead back into frame 1). Never change the character's design, clothes or colors; never mirror asymmetric details; no background, no camera moves, no second character. If the person asks for the other hand or arm, say explicitly which side is used now and which is used instead, in every affected frame. "summary" is one short sentence for the person (at most 90 characters): what is different in that frame.

Return:
- action "propose" when the request needs pose changes or playback changes (or both). List only frames that change, each at most once. Every playback field you do not change is null.
- action "none" for greetings, questions, or anything Focus cannot do here (a different character, a different action such as walk to run, a background, sound, turning the loop off, more than eight frames): poses empty, playback fields null, and say briefly what you can do instead.
reply: one or two short, warm sentences in English saying what you propose and why. Do not mention costs. Always reply in English, regardless of the user’s language. No lists, no markdown.`;
}

function describeFrame(frame: FlipbookFrame, position: number, description: string): string {
  return `${position}. ${frame.label} (${frame.phase})${frame.approved ? " [approved: locked, cannot be changed]" : ""}\n   ${description}`;
}

/** The plan as the model reads it: frames in playback order with their current instructions. */
export function chatContext(flipbook: Flipbook, playback: ChatPlayback | undefined, history: readonly ChatTurn[], message: string): string {
  const plan = flipbook.plan!;
  const spec = actionSpec(plan.action);
  const frames = orderedFrames(flipbook);
  const shown = playback ?? { drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion, speed: 1 };
  const recent = history.slice(-CHAT_HISTORY_LIMIT);
  return [
    `Character: ${flipbook.analysis?.subject ?? "the character"}. ${flipbook.analysis?.clothing ?? ""}`.trim(),
    `Action: ${spec.label}. Camera: ${plan.view ?? "side"}. Heading: ${plan.direction}. Travels: ${spec.travels ? "yes" : "no (stays on the spot)"}.`,
    `Playback now: ${shown.drawingFps} drawings per second, ${shown.durationSeconds} s, ${shown.motion === "in_place" ? "in place" : `travelling ${shown.motion}`}, speed ×${shown.speed}.`,
    `Frames in playback order:\n${frames.map((frame, index) => describeFrame(frame, plan.mode === "sequence" ? frame.poseIndex + 1 : index + 1, plan.poses[frame.poseIndex]?.description ?? "")).join("\n")}`,
    `Conversation so far:\n${recent.length ? recent.map((turn) => `${turn.role === "user" ? "Person" : "Assistant"}: ${turn.text}`).join("\n") : "none"}`,
    `Person: ${message}`,
  ].join("\n\n");
}

const ChatOutputSchema = z.object({
  reply: z.string().trim().min(1).max(600),
  action: z.enum(["propose", "none"]),
  poses: z
    .array(
      z.object({
        position: z.number().int(),
        summary: z.string().trim().max(400).default(""),
        description: z.string().trim().max(2000),
      }),
    )
    .max(48)
    .default([]),
  playback: z
    .object({
      drawingFps: z.number().nullable().optional(),
      speed: z.number().finite().nullable().optional(),
      durationSeconds: z.number().nullable().optional(),
      motion: z.enum(["in_place", "across"]).nullable().optional(),
    })
    .default({}),
});

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * Pure: model text, the saved flipbook and the playback on screen into a
 * validated proposal. Nothing the model says is trusted past this point:
 * frames come from positions it was shown, approved frames are left out and
 * named, unchanged descriptions cost nothing, numbers are clamped.
 */
export function parseChatOutput(text: string, flipbook: Flipbook, playback?: ChatPlayback): FlipbookProposal {
  const plan = flipbook.plan;
  if (!plan) throw new AppError("flipbook_not_ready", 409, "The pose plan isn’t ready yet.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("chat_invalid_output", 502, "Muse Spark returned an unreadable response. Try again.");
  }
  const parsed = ChatOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("chat_invalid_output", 502, "We couldn’t read the assistant’s response. Try again.", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const turn = parsed.data;
  const frames = orderedFrames(flipbook);
  const changes: PoseChange[] = [];
  const skipped: SkippedFrame[] = [];
  if (turn.action === "propose") {
    const seen = new Set<string>();
    for (const entry of turn.poses) {
      const frame = frames[entry.position - 1];
      if (!frame || seen.has(frame.id) || !entry.description) continue;
      seen.add(frame.id);
      const before = plan.poses[frame.poseIndex]?.description ?? "";
      const description = clip(entry.description, POSE_DESCRIPTION_MAX);
      if (description === before) continue;
      if (frame.approved) {
        skipped.push({ frame: frame.id, position: entry.position, label: frame.label, reason: "Approved frames are locked. Unapprove it to change it." });
        continue;
      }
      changes.push({ frame: frame.id, position: entry.position, label: frame.label, summary: clip(entry.summary || "Redrawn with the new instruction", 160), before, description });
    }
    changes.sort((a, b) => a.position - b.position);
  }

  const patch: PlaybackPatch = {};
  if (turn.action === "propose" && plan.mode !== "sequence") {
    const now = playback ?? { drawingFps: plan.drawingFps, durationSeconds: plan.durationSeconds, motion: plan.motion, speed: 1 };
    const { drawingFps, durationSeconds, speed, motion } = turn.playback;
    if ((drawingFps === 4 || drawingFps === 8 || drawingFps === 12) && drawingFps !== now.drawingFps) patch.drawingFps = drawingFps;
    if ((durationSeconds === 2 || durationSeconds === 4 || durationSeconds === 6 || durationSeconds === 20) && durationSeconds !== now.durationSeconds) patch.durationSeconds = durationSeconds;
    const spec = actionSpec(plan.action);
    // Only a cycle that travels can be carried across the stage.
    const nextMotion = motion === "across" ? (spec.travels ? plan.direction : undefined) : motion === "in_place" ? "in_place" : undefined;
    if (nextMotion && nextMotion !== now.motion) patch.motion = nextMotion;
    const finalMotion = patch.motion ?? now.motion;
    if (typeof speed === "number" && finalMotion !== "in_place") {
      const clamped = Math.round(Math.min(SPEED_BOUNDS[1], Math.max(SPEED_BOUNDS[0], speed)) * 100) / 100;
      if (clamped !== now.speed) patch.speed = clamped;
    }
  }
  const hasPlayback = Object.keys(patch).length > 0;

  const used = flipbook.budget.used;
  const limit = flipbook.budget.limit;
  const proposal = {
    reply: clip(turn.reply, 400),
    changes,
    playback: hasPlayback ? patch : null,
    skipped,
    cost: { drawings: changes.length, used, limit, overBy: Math.max(0, used + changes.length - limit) },
  };
  return FlipbookProposalSchema.parse(proposal);
}

export async function proposeChange(input: {
  readonly flipbook: Flipbook;
  readonly message: string;
  readonly history: readonly ChatTurn[];
  readonly playback?: ChatPlayback;
  readonly signal?: AbortSignal;
}): Promise<FlipbookProposal> {
  if (!input.flipbook.plan) throw new AppError("flipbook_not_ready", 409, "The pose plan isn’t ready yet.");
  if (input.flipbook.importedFrom) throw new AppError("imported_frames", 409, "These frames come from a Reference Motion render. Replace or reorder them, or render the motion again.");
  if (input.flipbook.sequence) {
    const all = orderedFrames(input.flipbook);
    const changes: PoseChange[] = [], skipped: SkippedFrame[] = [];
    let reply = "";
    for (let start = 0; start < all.length; start += 48) {
      const window = all.slice(start, start + 48);
      const positions = window.map((frame) => frame.poseIndex + 1);
      const text = await chatServices.complete({ instructions: chatInstructions(input.flipbook), input: chatContext({ ...input.flipbook, frames: window, order: window.map((frame) => frame.id) }, input.playback, input.history, input.message), flipbookId: input.flipbook.id, signal: input.signal, positions });
      const parsed = parseChatOutput(text, input.flipbook, input.playback);
      if (!reply || parsed.changes.length) reply = parsed.reply;
      changes.push(...parsed.changes.filter((entry) => positions.includes(entry.position)));
      skipped.push(...parsed.skipped.filter((entry) => positions.includes(entry.position)));
    }
    const { used, limit } = input.flipbook.budget;
    return storeProposal(input.flipbook, FlipbookProposalSchema.parse({ reply, changes, skipped, playback: null, cost: { drawings: changes.length, used, limit, overBy: Math.max(0, used + changes.length - limit) } }));
  }
  const text = await chatServices.complete({
    instructions: chatInstructions(input.flipbook),
    input: chatContext(input.flipbook, input.playback, input.history, input.message),
    flipbookId: input.flipbook.id,
    signal: input.signal,
  });
  return parseChatOutput(text, input.flipbook, input.playback);
}

async function completeWithMuseSpark(input: { readonly instructions: string; readonly input: string; readonly flipbookId: string; readonly signal?: AbortSignal; readonly positions?: readonly number[] }): Promise<string> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: input.instructions,
              reasoning: { effort: "low" },
              input: [{ type: "message", role: "user", content: [{ type: "input_text", text: input.input }] }],
              text: { format: { type: "json_schema", name: "flipbook_chat", strict: true, schema: chatJsonSchema(input.positions) } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({
      model: config.plannerModel,
      kind: "flipbook_chat",
      cached: false,
      ok: true,
      flipbookId: input.flipbookId,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - started,
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("chat_incomplete", 502, "The assistant didn’t finish its response. Try again.");
    }
    return response.output_text;
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "flipbook_chat", cached: false, ok: false, flipbookId: input.flipbookId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "the animation assistant");
  }
}
