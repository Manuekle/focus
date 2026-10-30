import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv, settingKeyProblem } from "../shared/settings";
import { assertSettingsAccess } from "./settings-access";
import { loadStoredSettings, settingsFile, settingsSnapshot, updateSettings } from "./settings";

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "focus-settings-"));
  vi.stubEnv("FOCUS_DATA_DIR", work);
});

afterEach(async () => {
  // Saved values go back to what the environment had.
  updateSettings({ unset: settingsSnapshot().settings.filter((setting) => setting.source === "settings").map((setting) => setting.key) });
  vi.unstubAllEnvs();
  await rm(work, { recursive: true, force: true });
});

describe("parseEnv", () => {
  it("reads comments, export, quotes, inline comments and multi-line values", () => {
    const { values, invalidLines } = parseEnv([
      "# comment",
      "",
      "export MODEL_API_KEY=abc123",
      "PLAIN=value # trailing note",
      'QUOTED="a # not a comment\\nnext"',
      "SINGLE='raw\\n'",
      'MULTI="line one',
      'line two"',
      "EMPTY=",
      "not an assignment",
    ].join("\n"));
    expect(values).toEqual({
      MODEL_API_KEY: "abc123",
      PLAIN: "value",
      QUOTED: "a # not a comment\nnext",
      SINGLE: "raw\\n",
      MULTI: "line one\nline two",
      EMPTY: "",
    });
    expect(invalidLines).toEqual([10]);
  });
});

describe("settingKeyProblem", () => {
  it("locks what decides where settings live, who changes them and how Node runs", () => {
    expect(settingKeyProblem("MODEL_API_KEY", true)).toBeNull();
    expect(settingKeyProblem("NEXT_PUBLIC_ENABLE_FLIPBOOK", true)).toBeNull();
    expect(settingKeyProblem("FOCUS_DATA_DIR", false)).not.toBeNull();
    expect(settingKeyProblem("FOCUS_ADMIN_TOKEN", false)).not.toBeNull();
    expect(settingKeyProblem("NODE_OPTIONS", false)).not.toBeNull();
    expect(settingKeyProblem("NEXT_RUNTIME", false)).not.toBeNull();
    expect(settingKeyProblem("lower_case", false)).not.toBeNull();
    expect(settingKeyProblem("FFMPEG_PATH", false)).toBeNull();
    expect(settingKeyProblem("FFMPEG_PATH", true)).not.toBeNull();
  });
});

describe("settings store", () => {
  it("saves to a private local file, applies at once and restores the environment on removal", async () => {
    vi.stubEnv("FOCUS_FREE_EDITS", "3");
    const result = updateSettings({ set: { FOCUS_FREE_EDITS: "10", MODEL_API_KEY: "secret-value-1234", FOCUS_DATA_DIR: "/elsewhere", EMPTY_ONE: " " } });
    expect([...result.saved].sort()).toEqual(["FOCUS_FREE_EDITS", "MODEL_API_KEY"]);
    expect(result.rejected.map((entry) => entry.key)).toEqual(["FOCUS_DATA_DIR"]);
    expect(process.env.FOCUS_FREE_EDITS).toBe("10");
    expect(process.env.MODEL_API_KEY).toBe("secret-value-1234");

    const file = settingsFile();
    expect(file.startsWith(work)).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8")).values).toEqual({ FOCUS_FREE_EDITS: "10", MODEL_API_KEY: "secret-value-1234" });

    const key = result.settings.find((setting) => setting.key === "MODEL_API_KEY")!;
    expect(key).toMatchObject({ source: "settings", secret: true, value: "••••1234" });
    expect(JSON.stringify(result)).not.toContain("secret-value-1234");

    updateSettings({ unset: ["FOCUS_FREE_EDITS"], set: { MODEL_API_KEY: "" } });
    expect(process.env.FOCUS_FREE_EDITS).toBe("3");
    expect(process.env.MODEL_API_KEY).toBeUndefined();
    expect(settingsSnapshot().settings.find((setting) => setting.key === "FOCUS_FREE_EDITS")).toMatchObject({ source: "environment", value: "3" });
  });

  it("loads saved values on start", () => {
    updateSettings({ set: { FOCUS_CHAT_PER_HOUR: "99" } });
    delete process.env.FOCUS_CHAT_PER_HOUR;
    loadStoredSettings();
    expect(process.env.FOCUS_CHAT_PER_HOUR).toBe("99");
  });
});

describe("assertSettingsAccess", () => {
  const request = (token?: string) => new Request("http://focus.test/api/settings", { headers: token ? { "x-focus-admin": token } : {} });

  it("is open locally and needs FOCUS_ADMIN_TOKEN in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertSettingsAccess(request())).not.toThrow();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FOCUS_ADMIN_TOKEN", "");
    expect(() => assertSettingsAccess(request("x"))).toThrow(expect.objectContaining({ code: "settings_disabled" }));
    vi.stubEnv("FOCUS_ADMIN_TOKEN", "right-token");
    expect(() => assertSettingsAccess(request("wrong"))).toThrow(expect.objectContaining({ code: "admin_token_required" }));
    expect(() => assertSettingsAccess(request("right-token"))).not.toThrow();
  });
});
