import { z } from "zod";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { guardAiRequest } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { activeRuns, assertRotoscopeEnabled, drawBatch } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** Another round: every idle run of the batch draws its first frame once more (one Muse Image drawing each). */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new AppError("batch_not_found", 404, "This test batch doesn’t exist.");
    const gate = () => guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { models: ["planner", "image"] });
    return Response.json(await drawBatch(id.data, user.id, gate));
  } catch (error) {
    return errorResponse(error);
  }
}
