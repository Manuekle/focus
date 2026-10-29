import { effectEnabled } from "../../../shared/features";
import { EditRequestSchema } from "../../../shared/schemas";
import { AppError, errorResponse } from "../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../server/guard";
import { createJob } from "../../../server/jobs";
import { attachJob } from "../../../server/projects";
import { anonymousId } from "../../../server/auth/session";
import { jsonWithCookies } from "../../../server/auth/routes";
import { currentUser } from "../../../server/auth/users";
import { getVideo } from "../../../server/videos";

// Explicit, user-triggered processing. Returns the job immediately; the
// editor polls /api/jobs/:id for progress. Each new generation spends one
// lifetime use; a signed-in edit is saved to the clip's project.
export async function POST(request: Request) {
  try {
    const parsed = EditRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError("invalid_edit", 400, "Describe your change in at least 3 characters and choose an effect.");
    }
    if (!effectEnabled(parsed.data.effect)) throw new AppError("effect_disabled", 400, "That effect isn’t available.");
    const user = await currentUser(request);
    const anon = user ? null : anonymousId(request);
    // Only new paid work counts: a repeated instruction reuses its job for free.
    const job = await createJob(parsed.data, async (cost) => {
      await guardAiRequest(request, cost, { models: ["planner", "segmentation"] });
    });
    if (user) {
      const video = await getVideo(job.videoId);
      await attachJob(user.id, job.videoId, job.id, video.originalName.replace(/\.[^.]+$/, ""));
    }
    return jsonWithCookies(job, [anon?.setCookie ?? null], { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
