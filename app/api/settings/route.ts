import { z } from "zod";
import { AppError, errorResponse } from "../../../server/errors";
import { settingsSnapshot, updateSettings } from "../../../server/settings";
import { assertSettingsAccess } from "../../../server/settings-access";
import { MAX_SETTING_VALUE_LENGTH, MAX_SETTINGS } from "../../../shared/settings";

const NO_STORE = { "Cache-Control": "no-store" };
/** A whole pasted .env fits; the shared JSON cap (16 KB) is for small requests. */
const MAX_BODY_BYTES = 256 * 1024;

const UpdateSchema = z
  .object({
    set: z.record(z.string().max(128), z.string().max(MAX_SETTING_VALUE_LENGTH)).optional(),
    unset: z.array(z.string().max(128)).max(MAX_SETTINGS).optional(),
  })
  .strict()
  .refine((update) => Object.keys(update.set ?? {}).length <= MAX_SETTINGS, "Too many settings at once.");

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError("body_too_large", 413, "This request is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("body_too_large", 413, "This request is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new AppError("invalid_json", 400, "We couldn’t read this request. Try again.");
  }
}

/** The variables Focus reads, where each value comes from, and secret hints only. */
export async function GET(request: Request) {
  try {
    assertSettingsAccess(request);
    return Response.json(settingsSnapshot(), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Saves values (`set`) and removes saved ones (`unset`), then applies them to this server. */
export async function PUT(request: Request) {
  try {
    assertSettingsAccess(request);
    const parsed = UpdateSchema.safeParse(await readBody(request));
    if (!parsed.success) throw new AppError("invalid_settings", 400, "These settings couldn’t be read.");
    return Response.json(updateSettings(parsed.data), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
