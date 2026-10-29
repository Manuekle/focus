import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityConnectionError, activityId, dismissActivity, getActivities, observeActivity, setActivityScope, trackActivity, type ActivityInput } from "./activity-store";
import { characterActivity, editActivity, flipbookActivity, observeCharacter } from "./activity-adapters";
import type { Character } from "../../shared/characters";
import type { Flipbook } from "../../shared/flipbook";
import type { EditJob } from "../../shared/schemas";

const task = (state: ActivityInput["state"] = "running", id = randomUUID()): ActivityInput => ({ id, title: "Animation", detail: "Drawing frames", href: null, state, progress: null });
beforeEach(() => { setActivityScope(randomUUID()); });

describe("activity lifecycle", () => {
  it("only reports completion for work that was actually tracked", () => {
    const input = task("completed");
    observeActivity(input);
    expect(getActivities()).toHaveLength(0);
    observeActivity({ ...input, state: "running", progress: 0.4 });
    expect(getActivities()[0].progress).toBe(0.4);
    observeActivity(input);
    expect(getActivities()[0].state).toBe("completed");
    dismissActivity(input.id);
    observeActivity(input);
    expect(getActivities()).toHaveLength(0);
    observeActivity({ ...input, state: "running" });
    expect(getActivities()).toHaveLength(1);
  });

  it("never dismisses active tasks or hides them behind the recent history limit", () => {
    const active = task();
    observeActivity(active);
    dismissActivity(active.id);
    for (let index = 0; index < 10; index++) observeActivity(task("completed"), true);
    expect(getActivities()).toHaveLength(6);
    expect(getActivities()[0].id).toBe(active.id);
  });

  it("does not report failed work just because the connection failed", () => {
    const active = task();
    observeActivity(active);
    activityConnectionError(active.id);
    expect(getActivities()[0]).toMatchObject({ state: "running", detail: "Reconnecting…", progress: null });
    activityConnectionError(active.id, true);
    expect(getActivities()[0].state).toBe("failed");
  });

  it("ignores an older server snapshot arriving after completion", () => {
    const active = { ...task(), sourceUpdatedAt: 100 };
    observeActivity(active);
    observeActivity({ ...active, state: "completed", sourceUpdatedAt: 200 });
    observeActivity(active);
    expect(getActivities()[0].state).toBe("completed");
  });

  it("hands a request to the server job without duplicating its activity", async () => {
    const resource = { kind: "flipbook" as const, id: randomUUID() };
    const result = { ...task(), id: activityId(resource), resource };
    await trackActivity({ title: "Preparing animation" }, async (update) => { update(0.25); return result; }, (value) => value);
    expect(getActivities()).toHaveLength(1);
    expect(getActivities()[0]).toMatchObject({ id: result.id, state: "running", progress: null });
  });

  it("records request errors and cancellations while preserving caller behavior", async () => {
    const error = new Error("Generation failed");
    await expect(trackActivity({ title: "Image" }, async () => { throw error; })).rejects.toBe(error);
    expect(getActivities()[0]).toMatchObject({ state: "failed", detail: error.message });
    const canceled = new DOMException("Canceled", "AbortError");
    await expect(trackActivity({ title: "Export" }, async () => { throw canceled; })).rejects.toBe(canceled);
    expect(getActivities().some((entry) => entry.state === "canceled")).toBe(true);
  });

  it("ignores late completions after changing account", async () => {
    let finish!: () => void;
    const pending = trackActivity({ title: "Old account" }, () => new Promise<void>((resolve) => { finish = resolve; }));
    setActivityScope("another-account");
    finish();
    await pending;
    expect(getActivities()).toHaveLength(0);
  });

  it("keeps a pending mutation running when an older foreground read arrives", async () => {
    const character = { id: randomUUID(), updatedAt: new Date().toISOString(), name: "Character", status: "ready", error: null } as Character;
    let finish!: (result: Character) => void;
    const pending = trackActivity({ title: "Generating image", resource: { kind: "character", id: character.id } }, () => new Promise<Character>((resolve) => { finish = resolve; }), characterActivity);
    observeCharacter(character);
    expect(getActivities()[0].state).toBe("running");
    finish({ ...character, status: "generating" });
    await pending;
    expect(getActivities()[0].state).toBe("running");
    observeCharacter({ ...character, updatedAt: new Date(Date.now() + 100).toISOString() });
    expect(getActivities()[0].state).toBe("completed");
  });

  it("restores server tasks but never leaves a request without a resource spinning", () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    setActivityScope("first", storage);
    const resource = { kind: "character" as const, id: randomUUID() };
    observeActivity({ ...task(), id: activityId(resource), resource });
    observeActivity(task());
    setActivityScope("second", storage);
    expect(getActivities()).toHaveLength(0);
    setActivityScope("first", storage);
    expect(getActivities().find((entry) => entry.resource)?.state).toBe("running");
    expect(getActivities().find((entry) => !entry.resource)?.state).toBe("canceled");
  });

  it("ignores corrupt or unsafe persisted links", () => {
    const entry = { ...task(), startedAt: Date.now(), updatedAt: Date.now(), observedAt: 0, href: "https://untrusted.example" };
    setActivityScope("saved", { getItem: () => JSON.stringify([entry]), setItem: vi.fn() });
    expect(getActivities()[0].href).toBe(null);
    setActivityScope("corrupt", { getItem: () => "not json", setItem: vi.fn() });
    expect(getActivities()).toHaveLength(0);
  });
});

describe("real job states", () => {
  const id = randomUUID(), updatedAt = new Date().toISOString();
  it("keeps video selection and render confirmation as needs input", () => {
    const job = { id, videoId: randomUUID(), request: { prompt: "Highlight the person" }, updatedAt, status: "awaiting_selection", detail: null, error: null, progress: 1 } as EditJob;
    expect(editActivity(job)).toMatchObject({ state: "waiting", progress: null, detail: "Pick a subject" });
    expect(editActivity({ ...job, status: "ready_to_render" }).state).toBe("waiting");
  });
  it("counts only measured animation work and distinguishes ready references", () => {
    const book = { id, updatedAt, title: "Dance", status: "generating", detail: null, error: null, progress: { done: 3, total: 12 }, plan: null } as Flipbook;
    expect(flipbookActivity(book)).toMatchObject({ state: "running", progress: 0.25 });
    expect(flipbookActivity({ ...book, progress: null }).progress).toBe(null);
    expect(flipbookActivity({ ...book, status: "reference_ready" }).state).toBe("waiting");
    expect(flipbookActivity({ ...book, status: "ready" }).state).toBe("completed");
    expect(flipbookActivity({ ...book, status: "ready", error: { code: "generation_failed", message: "One drawing failed." } }).state).toBe("failed");
  });
  it("shows image generation as indeterminate and preserves generation errors", () => {
    const character = { id, updatedAt, name: "Character", status: "generating", error: null } as Character;
    expect(characterActivity(character)).toMatchObject({ state: "running", progress: null });
    expect(characterActivity({ ...character, status: "failed", error: { code: "generation_failed", message: "Try another reference." } })).toMatchObject({ state: "failed", detail: "Try another reference." });
  });
});
