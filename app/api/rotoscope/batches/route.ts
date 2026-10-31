import { MAX_BATCH_CHARACTERS, MAX_BATCH_FRAMES } from "../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../server/errors";
import { guardAiRequest, guardUpload } from "../../../../server/guard";
import { requireUser } from "../../../../server/auth/require";
import { SERVER_MAX_UPLOAD_BYTES } from "../../../../server/media-limits";
import { declaredLength } from "../../../../server/animation/http";
import { activeRuns, assertRotoscopeEnabled, createBatch } from "../../../../server/rotoscope/service";
import { measuresFrom } from "../../../../server/rotoscope/measures";

/**
 * A test batch in one multipart request: the movement video once, then up to four characters as `character`,
 * each with its `characterName`, `frontOn` and measures (`heightCm`, `weightKg`) in the same order. Each one
 * becomes a run that draws only its first `frames` frames, once each (`dual`: by Higgsfield too); preparing is
 * free and the batch is charged once.
 */
export async function POST(request: Request) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const bytes = declaredLength(request);
    if (bytes !== undefined && bytes > SERVER_MAX_UPLOAD_BYTES + 64 * 1024 * 1024) throw new AppError("upload_too_large", 413, "These files are too large.");
    await guardUpload(request);
    await guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { models: ["planner", "image"] });
    const form = await request.formData().catch(() => null);
    const video = form?.get("video");
    const files = form?.getAll("character") ?? [];
    if (!(video instanceof File) || !files.length || !files.every((file) => file instanceof File)) throw new AppError("INPUT_INVALID", 400, "Choose a movement video and at least one character.");
    if (files.length > MAX_BATCH_CHARACTERS) throw new AppError("INPUT_INVALID", 400, `A test batch takes at most ${MAX_BATCH_CHARACTERS} characters.`);
    if (video.size > SERVER_MAX_UPLOAD_BYTES) throw new AppError("upload_too_large", 413, "This video is too large.");
    const at = (key: string, i: number) => String(form?.getAll(key)[i] ?? "");
    const personHeight = String(form?.get("personHeightCm") ?? "");
    const characters = (files as File[]).map((file, i) => ({
      file,
      name: at("characterName", i).trim().slice(0, 40) || `character ${i + 1}`,
      frontOn: at("frontOn", i) === "1",
      measures: measuresFrom({ heightCm: at("heightCm", i), weightKg: at("weightKg", i), personHeightCm: personHeight }),
    }));
    const batch = await createBatch({
      ownerId: user.id,
      video,
      characters,
      poseSheet: form?.get("poseSheet") !== "0",
      frames: Math.min(MAX_BATCH_FRAMES, Math.max(1, Number(form?.get("frames") ?? 1) || 1)),
      dual: form?.get("dual") === "1",
      options: { name: String(form?.get("name") ?? "") || undefined, fps: String(form?.get("fps") ?? ""), start: String(form?.get("start") ?? "0"), seconds: String(form?.get("seconds") ?? "") },
    });
    return Response.json(batch, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

