import path from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  isSecretSetting,
  MAX_SETTINGS,
  SETTINGS_CATALOG,
  settingApply,
  settingDefinition,
  settingKeyProblem,
  settingValueProblem,
  type SettingsSnapshot,
  type SettingsUpdate,
  type SettingsUpdateResult,
  type SettingView,
} from "../shared/settings";
import { dataRoot } from "./storage";

// Environment settings saved from the settings page. They live in one local
// file next to the rest of Focus's data (`<FOCUS_DATA_DIR>/settings/env.json`,
// mode 0600: a local folder or the production volume) and are applied on top
// of the process environment when the server starts (instrumentation.ts), when
// Next reads its config (next.config.ts: build-time flags) and on every save.
// Kept free of guard/quota imports so next.config.ts can load it.

type Stored = { readonly version: 1; readonly updatedAt: string; readonly values: Record<string, string> };

// The environment as the platform set it, before any saved value replaced it,
// so removing a saved value restores the original one.
const state = ((globalThis as { __focusSettings?: { original: Map<string, string | undefined>; applied: Set<string> } }).__focusSettings ??= {
  original: new Map(),
  applied: new Set(),
});

export function settingsFile(): string {
  return path.join(dataRoot(), "settings", "env.json");
}

function production(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Saved values that are still allowed here; a missing or unreadable file is no settings. */
export function readStoredSettings(): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
  const values = (parsed as Partial<Stored> | null)?.values;
  if (!values || typeof values !== "object") return {};
  const valid: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && !settingKeyProblem(key, production()) && !settingValueProblem(value)) valid[key] = value;
  }
  return valid;
}

function apply(values: Readonly<Record<string, string>>): void {
  for (const key of state.applied) {
    if (key in values) continue;
    const original = state.original.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
    state.applied.delete(key);
  }
  for (const [key, value] of Object.entries(values)) {
    if (!state.original.has(key)) state.original.set(key, process.env[key]);
    process.env[key] = value;
    state.applied.add(key);
  }
}

/** Puts the saved settings into process.env. Safe to call more than once. */
export function loadStoredSettings(): void {
  apply(readStoredSettings());
}

function hint(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : "••••";
}

export function settingsSnapshot(): SettingsSnapshot {
  const stored = readStoredSettings();
  const keys = new Set([...SETTINGS_CATALOG.map((definition) => definition.key), ...Object.keys(stored)]);
  const settings: SettingView[] = [...keys].map((key) => {
    const definition = settingDefinition(key);
    const secret = isSecretSetting(key);
    const original = state.original.has(key) ? state.original.get(key) : process.env[key];
    const running = key in stored ? stored[key] : original;
    return {
      key,
      group: definition?.group ?? "Custom",
      description: definition?.description ?? null,
      secret,
      apply: settingApply(key),
      source: key in stored ? "settings" : running ? "environment" : "unset",
      value: running ? (secret ? hint(running) : running) : null,
      locked: settingKeyProblem(key, production()),
    };
  });
  return { mode: production() ? "production" : "local", file: settingsFile(), settings };
}

/**
 * Saves and applies a change. An empty value removes the saved one, so pasting
 * a template with `KEY=` lines never blanks a variable the platform provides.
 */
export function updateSettings(update: SettingsUpdate): SettingsUpdateResult {
  const values = readStoredSettings();
  const rejected: { key: string; reason: string }[] = [];
  const saved: string[] = [];
  const removed: string[] = [];
  const remove = (key: string) => {
    if (!(key in values)) return;
    delete values[key];
    removed.push(key);
  };
  for (const key of update.unset ?? []) remove(key);
  for (const [key, value] of Object.entries(update.set ?? {})) {
    const problem = settingKeyProblem(key, production()) ?? settingValueProblem(value);
    if (problem) {
      rejected.push({ key, reason: problem });
      continue;
    }
    if (!value.trim()) {
      remove(key);
      continue;
    }
    if (!(key in values) && Object.keys(values).length >= MAX_SETTINGS) {
      rejected.push({ key, reason: `At most ${MAX_SETTINGS} saved settings.` });
      continue;
    }
    values[key] = value;
    saved.push(key);
  }
  if (saved.length || removed.length) {
    const file = settingsFile();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const body: Stored = { version: 1, updatedAt: new Date().toISOString(), values };
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }
  apply(values);
  return { ...settingsSnapshot(), saved, removed, rejected };
}
