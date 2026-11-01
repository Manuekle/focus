import { describe, expect, it } from "vitest";
import { createRightsStore } from "./rights-store";
import { fileRightsKey, rightsAssetKey } from "./rights";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("rights confirmation store", () => {
  it("is unchecked by default", () => {
    const store = createRightsStore(() => memoryStorage());
    expect(store.isConfirmed("edit|v1")).toBe(false);
  });

  it("keeps the confirmation for the same unchanged asset", () => {
    const backing = memoryStorage();
    const store = createRightsStore(() => backing);
    store.setConfirmed("edit|v1", true);
    expect(store.isConfirmed("edit|v1")).toBe(true);
    // A reload (fresh store, same session storage) still remembers it.
    expect(createRightsStore(() => backing).isConfirmed("edit|v1")).toBe(true);
  });

  it("resets when the source asset changes", () => {
    const store = createRightsStore(() => memoryStorage());
    store.setConfirmed("edit|v1", true);
    expect(store.isConfirmed("edit|v2")).toBe(false);
  });

  it("can be unchecked again", () => {
    const backing = memoryStorage();
    const store = createRightsStore(() => backing);
    store.setConfirmed("edit|v1", true);
    store.setConfirmed("edit|v1", false);
    expect(store.isConfirmed("edit|v1")).toBe(false);
    expect(backing.data.size).toBe(0);
  });

  it("ignores a confirmation stored under an older acknowledgement version", () => {
    const backing = memoryStorage();
    backing.setItem("focus:rights:edit|v1", "2000-01");
    expect(createRightsStore(() => backing).isConfirmed("edit|v1")).toBe(false);
  });

  it("still works in page when storage is blocked", () => {
    const store = createRightsStore(() => { throw new Error("blocked"); });
    store.setConfirmed("edit|v1", true);
    expect(store.isConfirmed("edit|v1")).toBe(true);
    expect(store.isConfirmed("edit|v2")).toBe(false);
  });

  it("notifies subscribers on change", () => {
    const store = createRightsStore(() => memoryStorage());
    let calls = 0;
    const off = store.subscribe(() => { calls += 1; });
    store.setConfirmed("a", true);
    off();
    store.setConfirmed("a", false);
    expect(calls).toBe(1);
  });
});

describe("rights asset keys", () => {
  it("changes when any file in the set is replaced", () => {
    const video = { name: "walk.mp4", size: 10, lastModified: 1 };
    const character = { name: "hero.png", size: 5, lastModified: 2 };
    const before = rightsAssetKey(["rotoscope", fileRightsKey(video), fileRightsKey(character)]);
    const after = rightsAssetKey(["rotoscope", fileRightsKey(video), fileRightsKey({ ...character, size: 6 })]);
    expect(before).not.toBe(after);
  });

  it("is null until every asset exists", () => {
    expect(rightsAssetKey(["animate", "a1", undefined])).toBeNull();
    expect(rightsAssetKey(["animate", "a1", ""])).toBeNull();
  });
});
