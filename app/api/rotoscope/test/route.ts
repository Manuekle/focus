import { AppError, errorResponse } from "../../../../server/errors";
import { guardAiRequest } from "../../../../server/guard";
import { requireUser } from "../../../../server/auth/require";
import { activeRuns, assertRotoscopeEnabled, drawTest } from "../../../../server/rotoscope/service";

/** A picture this page accepts, at most this large. */
const MAX_PICTURE_BYTES = 20 * 1024 * 1024;
const RUN_ID = /^[0-9a-f-]{36}$/;

const picture = async (value: FormDataEntryValue | null, what: string): Promise<Buffer | null> => {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_PICTURE_BYTES) throw new AppError("upload_too_large", 413, `The ${what} is too large.`);
  if (!/^image\/(png|jpeg|webp)$/.test(value.type)) throw new AppError("INPUT_INVALID", 400, `The ${what} must be a PNG, JPEG or WebP picture.`);
  return Buffer.from(await value.arrayBuffer());
};

/**
 * The test page's drawing (/rotoscope?test=…): `frame` (a picture) or `run` + `index` (a run's video frame), and
 * `character` (a picture) or `run` (its character), with `background` "scene" or "none". Returns the PNG as a data URL.
 */
export async function POST(request: Request) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const form = await request.formData().catch(() => null);
    if (!form) throw new AppError("INPUT_INVALID", 400, "We couldn’t read these pictures.");
    const run = typeof form.get("run") === "string" && RUN_ID.test(form.get("run") as string) ? form.get("run") as string : null;
    const index = Number(form.get("index"));
    const frame = await picture(form.get("frame"), "video frame") ?? (run && Number.isInteger(index) && index >= 1 ? { run, index } : null);
    const character = await picture(form.get("character"), "character") ?? (run ? { run } : null);
    if (!frame) throw new AppError("INPUT_INVALID", 400, "Add a video frame, or pick a run and one of its frames.");
    if (!character) throw new AppError("INPUT_INVALID", 400, "Add your character, or pick a run to use its character.");
    const background = form.get("background") === "scene" ? "scene" : "none";
    const gate = () => guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { models: ["image"] });
    const drawn = await drawTest(user.id, { frame, character, background }, gate);
    return Response.json({ image: `data:image/png;base64,${drawn.png.toString("base64")}`, prompt: drawn.prompt });
  } catch (error) {
    return errorResponse(error);
  }
}
