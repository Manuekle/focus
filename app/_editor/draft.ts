"use client";

import { EDITOR_DRAFT_KEY, EDITOR_DRAFT_TTL_MS, EditorDraftSchema, type EditorDraft } from "../../shared/account";
import { effectEnabled } from "../../shared/features";

// The home page hands its clip, instruction and effect to the editor through
// localStorage. It also outlives the trip through Facebook sign-in. Storage
// can be unavailable (private windows, blocked site data): then the editor
// simply opens on the clip without the instruction.

export function saveDraft(draft: Omit<EditorDraft, "savedAt">): void {
  try {
    localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Storage blocked: the URL still carries the clip.
  }
}

/** The pending draft for a clip, if any and fresh. */
export function readDraft(videoId: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(EDITOR_DRAFT_KEY);
    if (!raw) return null;
    const parsed = EditorDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.now() - parsed.data.savedAt > EDITOR_DRAFT_TTL_MS) {
      localStorage.removeItem(EDITOR_DRAFT_KEY);
      return null;
    }
    if (parsed.data.videoId !== videoId) return null;
    // A draft can survive a release rollback. Keep its text, without starting
    // a different edit automatically when its original effect is unavailable.
    if (effectEnabled(parsed.data.effect)) return parsed.data;
    const stable: EditorDraft = { ...parsed.data, effect: "reality-shift", autostart: false };
    try {
      localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(stable));
    } catch {
      // Read-only storage must not prevent recovering the instruction.
    }
    return stable;
  } catch {
    return null;
  }
}

/** Keeps the text but drops autostart, so a reload never generates twice. */
export function settleDraft(draft: EditorDraft): void {
  saveDraft({ ...draft, autostart: false });
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(EDITOR_DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
