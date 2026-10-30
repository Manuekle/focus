// Environment settings: the variables Focus reads, how a change reaches the
// running app, and a .env parser shared by the settings page (preview) and the
// server (save). Pure: no Node APIs, safe in the browser.

/** When a saved value takes effect. */
export type SettingApply =
  /** Read on every request: applies as soon as it is saved. */
  | "now"
  /** Read once when the server starts. */
  | "restart"
  /** Compiled into the bundle: restart `pnpm dev`, or rebuild a production image. */
  | "build";

export type SettingDefinition = {
  readonly key: string;
  readonly group: string;
  readonly description: string;
  readonly secret?: boolean;
  readonly apply: SettingApply;
};

export const SETTING_GROUPS = ["AI providers", "Accounts", "Limits", "Performance", "Abuse protection", "Features", "Animation worker", "Tools"] as const;

export const SETTINGS_CATALOG: readonly SettingDefinition[] = [
  { key: "MODEL_API_KEY", group: "AI providers", description: "Meta Model API key. Required for AI editing.", secret: true, apply: "now" },
  { key: "META_API_KEY", group: "AI providers", description: "Fallback name for the Meta key.", secret: true, apply: "now" },
  { key: "META_BASE_URL", group: "AI providers", description: "Meta Model API base URL.", apply: "now" },
  { key: "META_PLANNER_MODEL", group: "AI providers", description: "Planner model (default muse-spark-1.3).", apply: "now" },
  { key: "META_SEGMENTATION_MODEL", group: "AI providers", description: "Segmentation model (default sam-3.1).", apply: "now" },
  { key: "META_IMAGE_MODEL", group: "AI providers", description: "Image model (default muse-image-1.0).", apply: "now" },
  { key: "HF_CREDENTIALS", group: "AI providers", description: "Higgsfield key-id:key-secret for Rotoscope dual mode.", secret: true, apply: "now" },
  { key: "HIGGSFIELD_IMAGE_MODEL", group: "AI providers", description: "Higgsfield image model.", apply: "now" },

  { key: "FOCUS_SESSION_SECRET", group: "Accounts", description: "Signs session cookies (32+ characters). Required in production.", secret: true, apply: "restart" },
  { key: "FOCUS_FREE_EDITS", group: "Accounts", description: "Free generations per account or visitor.", apply: "now" },
  { key: "FACEBOOK_APP_ID", group: "Accounts", description: "Facebook Login app id.", apply: "now" },
  { key: "FACEBOOK_APP_SECRET", group: "Accounts", description: "Facebook Login app secret.", secret: true, apply: "now" },
  { key: "FACEBOOK_GRAPH_VERSION", group: "Accounts", description: "Graph API version (default v23.0).", apply: "now" },
  { key: "FOCUS_PUBLIC_URL", group: "Accounts", description: "Public origin for OAuth, links and the sitemap.", apply: "build" },
  { key: "FOCUS_AUTH_SIMULATED", group: "Accounts", description: "1 allows the simulated sign-in on a production build.", apply: "now" },

  { key: "FOCUS_MAX_VIDEO_DURATION_SECONDS", group: "Limits", description: "Longest accepted clip, 1–600 s.", apply: "build" },
  { key: "FOCUS_MAX_UPLOAD_MB", group: "Limits", description: "Video upload cap, 1–1024 MB.", apply: "build" },
  { key: "FOCUS_MAX_IMAGE_UPLOAD_MB", group: "Limits", description: "Image upload cap, 1–15 MB.", apply: "build" },
  { key: "FOCUS_MAX_DATA_MB", group: "Limits", description: "Disk budget for the data folder (0 = off).", apply: "now" },
  { key: "FOCUS_MIN_FREE_MB", group: "Limits", description: "Free disk kept aside when the budget is on.", apply: "now" },
  { key: "FOCUS_FLIPBOOK_IMAGE_BUDGET", group: "Limits", description: "Drawings per animation before a confirmation.", apply: "now" },
  { key: "FOCUS_CHARACTER_IMAGE_BUDGET", group: "Limits", description: "Image generations per character.", apply: "now" },

  { key: "FOCUS_PLANNER_CONCURRENCY", group: "Performance", description: "Parallel Muse Spark plans (1–16).", apply: "restart" },
  { key: "FOCUS_SEGMENTATION_CONCURRENCY", group: "Performance", description: "Parallel SAM 3.1 passes (1–16).", apply: "restart" },
  { key: "FOCUS_IMAGE_CONCURRENCY", group: "Performance", description: "Parallel Muse Image drawings (1–16).", apply: "restart" },
  { key: "FOCUS_RENDER_CONCURRENCY", group: "Performance", description: "Parallel FFmpeg renders (1–16).", apply: "restart" },

  { key: "FOCUS_AI_DISABLED", group: "Abuse protection", description: "1 refuses all new AI work.", apply: "now" },
  { key: "FOCUS_AI_REQUESTS_PER_HOUR", group: "Abuse protection", description: "Paid AI requests per client per hour.", apply: "now" },
  { key: "FOCUS_UPLOADS_PER_HOUR", group: "Abuse protection", description: "Uploads per client per hour.", apply: "now" },
  { key: "FOCUS_CHAT_PER_HOUR", group: "Abuse protection", description: "AI editor messages per client per hour.", apply: "now" },
  { key: "FOCUS_RENDERS_PER_HOUR", group: "Abuse protection", description: "Renders per client per hour.", apply: "now" },
  { key: "FOCUS_MAX_ACTIVE_JOBS", group: "Abuse protection", description: "Jobs running at once across all clients.", apply: "now" },
  { key: "FOCUS_SAM_DAILY_FRAMES", group: "Abuse protection", description: "SAM 3.1 frames per UTC day (0 = no budget).", apply: "now" },
  { key: "FOCUS_TRUST_PROXY", group: "Abuse protection", description: "1 identifies clients by X-Forwarded-For.", apply: "now" },

  { key: "NEXT_PUBLIC_ENABLE_FLIPBOOK", group: "Features", description: "Flipbook and My characters.", apply: "build" },
  { key: "NEXT_PUBLIC_ENABLE_ROTOSCOPE", group: "Features", description: "Rotoscope studio.", apply: "build" },
  { key: "NEXT_PUBLIC_ENABLE_POSE_TO_POSE", group: "Features", description: "Pose-to-pose keys and in-betweens.", apply: "build" },
  { key: "NEXT_PUBLIC_ENABLE_REFERENCE_MOTION", group: "Features", description: "Reference Motion (GPU worker).", apply: "build" },
  { key: "NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", group: "Features", description: "Time Freeze (experimental).", apply: "build" },

  { key: "GPU_WORKER_URL", group: "Animation worker", description: "Private GPU worker URL.", apply: "now" },
  { key: "GPU_WORKER_TOKEN", group: "Animation worker", description: "Token shared with the worker.", secret: true, apply: "now" },
  { key: "ANIMATION_URL_SECRET", group: "Animation worker", description: "Signs the worker's short-lived URLs (32+ characters).", secret: true, apply: "now" },
  { key: "ANIMATION_CALLBACK_BASE_URL", group: "Animation worker", description: "Where the worker reaches Focus.", apply: "now" },
  { key: "ANIMATION_DEFAULT_ENGINE", group: "Animation worker", description: "Default engine (steadydancer).", apply: "now" },

  { key: "FFMPEG_PATH", group: "Tools", description: "FFmpeg binary (local only).", apply: "now" },
  { key: "FFPROBE_PATH", group: "Tools", description: "FFprobe binary (local only).", apply: "now" },
  { key: "ROTOSCOPE_PYTHON", group: "Tools", description: "Python with rtmlib for DWPose (local only).", apply: "restart" },
];

const CATALOG = new Map(SETTINGS_CATALOG.map((definition) => [definition.key, definition]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return CATALOG.get(key);
}

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS)/;

export function isSecretSetting(key: string): boolean {
  return CATALOG.get(key)?.secret ?? SECRET_NAME.test(key);
}

export function settingApply(key: string): SettingApply {
  return CATALOG.get(key)?.apply ?? (key.startsWith("NEXT_PUBLIC_") ? "build" : "now");
}

export const MAX_SETTING_VALUE_LENGTH = 8 * 1024;
export const MAX_SETTINGS = 200;
const KEY = /^[A-Z][A-Z0-9_]{0,127}$/;

/**
 * Variables the settings page never writes. They decide where the settings
 * themselves live, who may change them, or how Node loads code.
 */
const LOCKED = new Set(["FOCUS_DATA_DIR", "FOCUS_ADMIN_TOKEN", "NODE_ENV", "NODE_OPTIONS", "PATH", "HOME", "PORT", "HOSTNAME", "TMPDIR", "NEXT_RUNTIME"]);
const LOCKED_PREFIX = /^(NODE_|NPM_|LD_|DYLD_|__|NEXT_(?!PUBLIC_))/;
/** Paths to programs Focus runs: on a public server a stolen admin token must not choose them. */
export const EXECUTABLE_SETTINGS = new Set(["FFMPEG_PATH", "FFPROBE_PATH", "ROTOSCOPE_PYTHON"]);

/** Why a key can't be saved here, or null when it can. */
export function settingKeyProblem(key: string, production: boolean): string | null {
  if (!KEY.test(key)) return "Use UPPER_SNAKE_CASE letters, digits and underscores.";
  if (LOCKED.has(key) || LOCKED_PREFIX.test(key)) return "Set this one in your shell or hosting platform.";
  if (production && EXECUTABLE_SETTINGS.has(key)) return "Program paths can only be changed on a local install.";
  return null;
}

export function settingValueProblem(value: string): string | null {
  if (value.length > MAX_SETTING_VALUE_LENGTH) return "Value is longer than 8 KB.";
  if (value.includes("\0")) return "Value contains a NUL character.";
  return null;
}

export type ParsedEnv = {
  readonly values: Readonly<Record<string, string>>;
  /** Line numbers (1-based) that are not KEY=value assignments. */
  readonly invalidLines: readonly number[];
};

/**
 * Parses .env text the way dotenv files are usually written: comments, blank
 * lines, an optional `export`, single or double quotes (double quotes expand
 * \n), multi-line quoted values and inline ` #` comments after unquoted values.
 */
export function parseEnv(text: string): ParsedEnv {
  const values: Record<string, string> = {};
  const invalidLines: number[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      invalidLines.push(i + 1);
      continue;
    }
    const [, key, rest] = match;
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      let body = rest.slice(1);
      let end = body.indexOf(quote);
      // A quoted value may continue on the next lines until its closing quote.
      while (end < 0 && i + 1 < lines.length) {
        body += `\n${lines[++i]}`;
        end = body.indexOf(quote);
      }
      if (end < 0) {
        invalidLines.push(i + 1);
        continue;
      }
      const raw = body.slice(0, end);
      values[key] = quote === '"' ? raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"') : raw;
    } else {
      values[key] = rest.replace(/\s+#.*$/, "").trim();
    }
  }
  return { values, invalidLines };
}

/** What the settings API reports for one variable. Secret values never leave the server. */
export type SettingView = {
  readonly key: string;
  readonly group: string;
  readonly description: string | null;
  readonly secret: boolean;
  readonly apply: SettingApply;
  /** Where the running value comes from. */
  readonly source: "settings" | "environment" | "unset";
  /** Full value for plain settings; for secrets only a hint such as "••••a1b2". */
  readonly value: string | null;
  readonly locked: string | null;
};

export type SettingsSnapshot = {
  readonly mode: "local" | "production";
  readonly file: string;
  readonly settings: readonly SettingView[];
};

export type SettingsUpdate = {
  readonly set?: Readonly<Record<string, string>>;
  readonly unset?: readonly string[];
};

export type SettingsUpdateResult = SettingsSnapshot & {
  readonly saved: readonly string[];
  readonly removed: readonly string[];
  readonly rejected: readonly { readonly key: string; readonly reason: string }[];
};
