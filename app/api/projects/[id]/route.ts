import { UpdateProjectRequestSchema, type ProjectDetail } from "../../../../shared/account";
import type { EditJob } from "../../../../shared/schemas";
import { AppError, errorResponse } from "../../../../server/errors";
import { readJsonBody } from "../../../../server/guard";
import { getJob } from "../../../../server/jobs";
import { deleteProject, getProject, updateProject } from "../../../../server/projects";
import { requireUser } from "../../../../server/auth/require";
import { getVideo } from "../../../../server/videos";

type Context = { params: Promise<{ id: string }> };

/** A project with its clip and every edit that still exists, newest first. */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const project = await getProject((await params).id, user.id);
    const jobs = (await Promise.all(project.jobIds.map((id) => getJob(id).catch(() => null)))).filter((job): job is EditJob => job !== null).reverse();
    const detail: ProjectDetail = { project, video: await getVideo(project.videoId), jobs };
    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    const parsed = UpdateProjectRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_project", 400, "El nombre del proyecto no es válido.");
    return Response.json(await updateProject((await params).id, user.id, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Removes the project; its clip then expires like any other upload. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await requireUser(request);
    await deleteProject((await params).id, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
