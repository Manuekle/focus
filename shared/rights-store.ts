import { RIGHTS_VERSION } from "./rights";

// Where the checkbox answer lives in the browser. It is keyed by the asset the
// person confirmed, so a different file (or a different set of files) is
// simply unconfirmed: replacing the source resets the box with no extra code.
// Session storage keeps it across a reload and the hop from upload to editor,
// and no further.

const PREFIX = "focus:rights:";

type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type RightsStore = {
  readonly isConfirmed: (assetKey: string) => boolean;
  readonly setConfirmed: (assetKey: string, confirmed: boolean) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createRightsStore(backing: () => Backing | null): RightsStore {
  // Mirrors the storage so private windows that refuse it still work in-page.
  const memory = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const storage = (): Backing | null => {
    try {
      return backing();
    } catch {
      return null;
    }
  };
  return {
    isConfirmed(assetKey) {
      const remembered = memory.get(assetKey);
      if (remembered !== undefined) return remembered;
      try {
        return storage()?.getItem(PREFIX + assetKey) === RIGHTS_VERSION;
      } catch {
        return false;
      }
    },
    setConfirmed(assetKey, confirmed) {
      memory.set(assetKey, confirmed);
      try {
        if (confirmed) storage()?.setItem(PREFIX + assetKey, RIGHTS_VERSION);
        else storage()?.removeItem(PREFIX + assetKey);
      } catch {
        // The in-page copy still answers.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const rightsStore = createRightsStore(() => (typeof window === "undefined" ? null : window.sessionStorage));
