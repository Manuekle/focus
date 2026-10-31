import type { Character, CharacterSummary } from "../../shared/characters";
import { ACTIVE_FLIPBOOK_STATUSES, flipbookTitle, type Flipbook, type FlipbookSummary } from "../../shared/flipbook";
import type { RotoscopeRun, RotoscopeRunSummary } from "../../shared/rotoscope";
import { ACTIVE_JOB_STATUSES, type EditJob } from "../../shared/schemas";
import { activityHref, activityId, activityRequestPending, getActivities, observeActivity, type ActivityInput, type ActivityResource } from "./activity-store";

const sourceTime = (value: string) => new Date(value).getTime();
function identity(resource: ActivityResource) { return { id: activityId(resource), resource, href: activityHref(resource) }; }

export function editActivity(job: EditJob): ActivityInput {
  const active = ACTIVE_JOB_STATUSES.includes(job.status);
  const state = active ? "running" : job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "canceled" ? "canceled" : "waiting";
  return {
    ...identity({ kind: "edit", id: job.id }), href: `/editor?v=${job.videoId}`,
    title: job.request.prompt.slice(0, 80), state,
    detail: job.error?.message ?? job.detail ?? (state === "waiting" ? job.status === "awaiting_selection" ? "Pick a subject" : job.status === "ready_to_render" ? "Ready to render" : "Needs more detail" : active ? "Processing video…" : "Completed"),
    progress: active ? job.progress : state === "completed" ? 1 : null,
    sourceUpdatedAt: sourceTime(job.updatedAt),
  };
}

type AnimationSnapshot = Pick<Flipbook, "id" | "title" | "prompt" | "status" | "detail" | "progress" | "error" | "updatedAt">;
type CharacterSnapshot = Pick<Character, "id" | "name" | "status" | "error" | "updatedAt">;
export function flipbookActivity(book: AnimationSnapshot): ActivityInput {
  const active = ACTIVE_FLIPBOOK_STATUSES.includes(book.status);
  const state = active ? "running" : book.status === "canceled" ? "canceled" : book.status === "failed" || book.status === "unsupported" || book.error ? "failed" : book.status === "ready" ? "completed" : "waiting";
  return {
    ...identity({ kind: "flipbook", id: book.id }), title: flipbookTitle(book) || "Animation", state,
    detail: book.error?.message ?? book.detail ?? (state === "waiting" ? "Ready to animate" : active ? "Preparing animation…" : state === "failed" ? "This animation couldn’t be made." : "Completed"),
    progress: active && book.progress ? Math.min(1, book.progress.done / book.progress.total) : state === "completed" ? 1 : null,
    sourceUpdatedAt: sourceTime(book.updatedAt),
  };
}

export function characterActivity(character: CharacterSnapshot): ActivityInput {
  return {
    ...identity({ kind: "character", id: character.id }), title: character.name,
    state: character.status === "generating" ? "running" : character.status === "failed" ? "failed" : "completed",
    detail: character.error?.message ?? (character.status === "generating" ? "Drawing a new version…" : "Image ready"),
    progress: character.status === "ready" ? 1 : null, sourceUpdatedAt: sourceTime(character.updatedAt),
  };
}

type RotoscopeSnapshot = Pick<RotoscopeRun, "id" | "name" | "phase" | "total" | "approved" | "error" | "halted" | "live" | "maxAttempts">;
export function rotoscopeActivity(run: RotoscopeSnapshot): ActivityInput {
  const active = run.phase === "preparing" || run.phase === "extending" || run.phase === "generating" || run.phase === "stopping";
  const complete = run.total > 0 && run.approved === run.total;
  const state = active ? "running" : run.phase === "failed" || run.error ? "failed" : complete ? "completed" : "waiting";
  const detail = run.phase === "preparing" ? "Cutting the video into frames…"
    : run.phase === "extending" ? "Adding the next part of the video…"
    : run.phase === "stopping" ? "Stopping after this drawing…"
      : run.live ? `Frame ${run.live.frame} of ${run.total} · attempt ${run.live.tries}/${run.maxAttempts}`
        : active ? "Drawing…"
          : run.error ?? (complete ? `All ${run.total} frames approved` : run.halted ? `Stopped at frame ${run.halted.frame}: needs your review` : `${run.approved}/${run.total} frames approved${run.approved < run.total ? " · the rest need another try" : ""}`);
  return {
    ...identity({ kind: "rotoscope", id: run.id }), title: run.name || "Rotoscope", state, detail,
    progress: run.phase === "generating" && run.total ? run.approved / run.total : complete && !active ? 1 : null,
    ...(run.live ? { sourceUpdatedAt: sourceTime(run.live.at) } : {}),
  };
}

const observeSnapshot = (input: ActivityInput) => { if (!activityRequestPending(input.id)) observeActivity(input); };
export const observeEdit = (value: EditJob) => observeSnapshot(editActivity(value));
export const observeFlipbook = (value: AnimationSnapshot) => observeSnapshot(flipbookActivity(value));
export const observeCharacter = (value: CharacterSnapshot) => observeSnapshot(characterActivity(value));
export const observeRotoscope = (value: RotoscopeSnapshot) => observeSnapshot(rotoscopeActivity(value));

/** Discover active saved work without replacing a detailed progress snapshot with a summary. */
export function discoverAnimations(values: FlipbookSummary[]) {
  for (const value of values) if (ACTIVE_FLIPBOOK_STATUSES.includes(value.status) && !getActivities().some((entry) => entry.id === `flipbook:${value.id}`)) {
    observeFlipbook({ ...value, prompt: value.title, detail: null, progress: null, error: null });
  }
}
export function discoverCharacters(values: CharacterSummary[]) {
  for (const value of values) if (value.status === "generating" && !getActivities().some((entry) => entry.id === `character:${value.id}`)) {
    observeCharacter({ ...value, error: null });
  }
}
export function discoverRotoscopeRuns(values: RotoscopeRunSummary[]) {
  for (const value of values) if ((value.phase === "preparing" || value.phase === "extending" || value.phase === "generating" || value.phase === "stopping") && !getActivities().some((entry) => entry.id === `rotoscope:${value.id}`)) {
    observeRotoscope({ ...value, error: null, halted: null, live: null, maxAttempts: 0 });
  }
}
