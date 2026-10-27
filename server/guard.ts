import { AppError } from "./errors";
import { samFramesSince } from "./ai/usage";

// Abuse and cost protection for a public deployment. Everything is in-process
// (single container); limits are configured with environment variables.
//
//   FOCUS_AI_DISABLED=1            emergency switch: no new Meta AI work
//   FOCUS_AI_REQUESTS_PER_HOUR=30  paid requests per client per hour
//   FOCUS_UPLOADS_PER_HOUR=20      uploads per client per hour
//   FOCUS_CHAT_PER_HOUR=60         AI editor messages per client per hour
//   FOCUS_MAX_ACTIVE_JOBS=4        jobs running at once, all clients
//   FOCUS_SAM_DAILY_FRAMES=20000   SAM frames per UTC day (0 = no budget)
//   FOCUS_TRUST_PROXY=1            read the client IP from X-Forwarded-For

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export function guardConfig() {
  return {
    aiDisabled: process.env.FOCUS_AI_DISABLED === "1",
    aiPerHour: number("FOCUS_AI_REQUESTS_PER_HOUR", 30),
    uploadsPerHour: number("FOCUS_UPLOADS_PER_HOUR", 20),
    chatPerHour: number("FOCUS_CHAT_PER_HOUR", 60),
    maxActiveJobs: number("FOCUS_MAX_ACTIVE_JOBS", 4),
    samDailyFrames: number("FOCUS_SAM_DAILY_FRAMES", 20000),
    trustProxy: process.env.FOCUS_TRUST_PROXY === "1",
  };
}

const windows = ((globalThis as { __focusRate?: Map<string, number[]> }).__focusRate ??= new Map());
const HOUR = 60 * 60 * 1000;

/** The requesting client. Behind a trusted proxy, its first X-Forwarded-For hop. */
export function clientKey(request: Request): string {
  if (guardConfig().trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return request.headers.get("x-real-ip") ?? "local";
}

/** Sliding one-hour window. Returns seconds until the next slot when over the limit. */
export function takeSlot(bucket: string, key: string, limit: number, now = Date.now()): number | null {
  if (limit <= 0) return null;
  const id = `${bucket}:${key}`;
  const recent: number[] = (windows.get(id) ?? []).filter((at: number) => now - at < HOUR);
  if (recent.length >= limit) {
    windows.set(id, recent);
    return Math.ceil((recent[0] + HOUR - now) / 1000);
  }
  recent.push(now);
  windows.set(id, recent);
  return null;
}

export function resetRateLimits(): void {
  windows.clear();
}

function tooMany(waitSeconds: number, what: string): AppError {
  const minutes = Math.max(1, Math.ceil(waitSeconds / 60));
  return new AppError("rate_limited", 429, `You’ve reached the hourly limit for ${what}. Try again in ${minutes} min.`);
}

export function guardUpload(request: Request): void {
  const wait = takeSlot("upload", clientKey(request), guardConfig().uploadsPerHour);
  if (wait !== null) throw tooMany(wait, "uploads");
}

/**
 * Checks every limit before paid Meta AI work starts. `estimatedFrames` is the
 * SAM cost of the request (billed with a 50-frame minimum).
 */
export async function guardAiRequest(request: Request, input: { activeJobs: number; estimatedFrames: number }): Promise<void> {
  const config = guardConfig();
  if (config.aiDisabled) {
    throw new AppError("ai_disabled", 503, "AI editing is temporarily paused. Try again later.");
  }
  if (config.maxActiveJobs > 0 && input.activeJobs >= config.maxActiveJobs) {
    throw new AppError("busy", 503, "Too many videos are processing right now. Try again in a minute.");
  }
  if (config.samDailyFrames > 0) {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const used = await samFramesSince(midnight);
    if (used + Math.max(50, input.estimatedFrames) > config.samDailyFrames) {
      throw new AppError("budget_exhausted", 503, "The daily AI processing limit has been reached. Try again tomorrow.");
    }
  }
  const wait = takeSlot("ai", clientKey(request), config.aiPerHour);
  if (wait !== null) throw tooMany(wait, "AI edits");
}

/**
 * AI editor turns: one small Muse Spark call each, never SAM, so they have
 * their own hourly window instead of spending the edit allowance.
 */
export function guardChatRequest(request: Request): void {
  const config = guardConfig();
  if (config.aiDisabled) {
    throw new AppError("ai_disabled", 503, "AI editing is temporarily paused. Try again later.");
  }
  const wait = takeSlot("chat", clientKey(request), config.chatPerHour);
  if (wait !== null) throw tooMany(wait, "AI editor messages");
}

const MAX_JSON_BYTES = 16 * 1024;

/** Reads a small JSON body; anything larger or malformed is rejected before parsing. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new AppError("body_too_large", 413, "This request is too large.");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new AppError("body_too_large", 413, "This request is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_json", 400, "We couldn’t read this request. Try again.");
  }
}
