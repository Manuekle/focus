import type { Character, CharacterSummary } from "../../shared/characters";
import { ACTIVE_FLIPBOOK_STATUSES, flipbookTitle, type Flipbook, type FlipbookSummary } from "../../shared/flipbook";
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

const observeSnapshot = (input: ActivityInput) => { if (!activityRequestPending(input.id)) observeActivity(input); };
export const observeEdit = (value: EditJob) => observeSnapshot(editActivity(value));
export const observeFlipbook = (value: AnimationSnapshot) => observeSnapshot(flipbookActivity(value));
export const observeCharacter = (value: CharacterSnapshot) => observeSnapshot(characterActivity(value));

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
