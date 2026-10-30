import { AppError, errorResponse } from "../../../../server/errors";
import { guardAiRequest, guardUpload } from "../../../../server/guard";
import { requireUser } from "../../../../server/auth/require";
import { SERVER_MAX_UPLOAD_BYTES } from "../../../../server/media-limits";
import { declaredLength } from "../../../../server/animation/http";
import { activeRuns, assertRotoscopeEnabled, createRun, listRuns } from "../../../../server/rotoscope/service";

export async function GET(request: Request) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    return Response.json(await listRuns(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

// One multipart request: the movement video (kept as uploaded, so its frames
// match the user's own export), the character image and the frame rate.
export async function POST(request: Request) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const bytes = declaredLength(request);
    if (bytes !== undefined && bytes > SERVER_MAX_UPLOAD_BYTES + 32 * 1024 * 1024) throw new AppError("upload_too_large", 413, "These files are too large.");
    await guardUpload(request);
    // Preparing asks Muse Spark to describe the character once; drawing is charged when it starts.
    await guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { charge: false, models: ["planner"] });
    const form = await request.formData().catch(() => null);
    const video = form?.get("video");
    const character = form?.get("character");
    if (!(video instanceof File) || !(character instanceof File)) throw new AppError("INPUT_INVALID", 400, "Choose a movement video and a character image.");
    if (video.size > SERVER_MAX_UPLOAD_BYTES) throw new AppError("upload_too_large", 413, "This video is too large.");
    const run = await createRun({
      ownerId: user.id,
      video,
      character,
      options: { name: String(form?.get("name") ?? "") || undefined, fps: String(form?.get("fps") ?? ""), start: String(form?.get("start") ?? "0"), seconds: String(form?.get("seconds") ?? "") },
    });
    return Response.json(run, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
