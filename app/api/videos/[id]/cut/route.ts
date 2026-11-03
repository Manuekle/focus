import { AppError, errorResponse } from "../../../../../server/errors";
import { guardUpload } from "../../../../../server/guard";
import { cutVideo } from "../../../../../server/videos";
import { CutRequestSchema } from "../../../../../shared/cut";

type Context = { params: Promise<{ id: string }> };

// The timeline's cut list, applied: a new, shorter clip. Local FFmpeg work and
// a new file on disk, so it counts against the upload limit like an upload.
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await guardUpload(request);
    const parsed = CutRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_cut", 400, "That cut isn’t valid. Keep at least one part of the clip.");
    return Response.json(await cutVideo(id, parsed.data.keep), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
