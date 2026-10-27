import { CreateProjectRequestSchema } from "../../../shared/account";
import { AppError, errorResponse } from "../../../server/errors";
import { readJsonBody } from "../../../server/guard";
import { jobsForVideo } from "../../../server/jobs";
import { listProjects, projectForVideo, summarize } from "../../../server/projects";
import { requireUser } from "../../../server/auth/require";
import { getVideo } from "../../../server/videos";

/** The signed-in user's projects, most recent first. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json((await listProjects(user.id)).map(summarize), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Saves a clip (and every edit already made on it) to the account. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const parsed = CreateProjectRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_project", 400, "Falta el video del proyecto.");
    const video = await getVideo(parsed.data.videoId);
    const jobIds = (await jobsForVideo(video.id)).map((job) => job.id).reverse();
    const project = await projectForVideo(user.id, video.id, { title: video.originalName.replace(/\.[^.]+$/, ""), jobIds });
    return Response.json(project, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
