import { effectEnabled } from "../../../shared/features";
import { EditRequestSchema } from "../../../shared/schemas";
import { AppError, errorResponse } from "../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../server/guard";
import { createJob } from "../../../server/jobs";
import { attachJob } from "../../../server/projects";
import { consumeFreeEdit } from "../../../server/quota";
import { anonymousId } from "../../../server/auth/session";
import { jsonWithCookies } from "../../../server/auth/routes";
import { currentUser } from "../../../server/auth/users";
import { getVideo } from "../../../server/videos";

// Explicit, user-triggered processing. Returns the job immediately; the
// editor polls /api/jobs/:id for progress. Without an account, each new edit
// spends one of the free edits; a signed-in edit is saved to the clip's project.
export async function POST(request: Request) {
  try {
    const parsed = EditRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError("invalid_edit", 400, "Describe el cambio con al menos 3 caracteres y elige un efecto.");
    }
    if (!effectEnabled(parsed.data.effect)) throw new AppError("effect_disabled", 400, "Ese efecto no está disponible.");
    const user = await currentUser(request);
    const anon = user ? null : anonymousId(request);
    const job = await createJob(parsed.data, async (cost) => {
      await guardAiRequest(request, cost);
      // Only new paid work counts: a repeated instruction reuses its job for free.
      if (anon) await consumeFreeEdit(request, anon.id);
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
