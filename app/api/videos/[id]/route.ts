import { errorResponse } from "../../../../server/errors";
import { retainedIds } from "../../../../server/projects";
import { deleteVideo, getVideo } from "../../../../server/videos";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await getVideo(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    // A clip saved in a project is only removed with its project.
    if (!(await retainedIds()).videos.has(id)) await deleteVideo(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
