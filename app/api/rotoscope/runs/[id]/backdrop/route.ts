import { BackdropSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { activeRuns, assertRotoscopeEnabled, drawBackdrop } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** Draws a preview background: `{ kind: "plate" }` clones the video's room without the person, `{ kind: "scenery" }` redraws it in the character's style. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const options = BackdropSchema.safeParse(await readJsonBody(request));
    if (!options.success) throw new AppError("INPUT_INVALID", 400, "We couldn’t read which background to make.");
    const gate = () => guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { models: ["image"] });
    return Response.json(await drawBackdrop((await params).id, user.id, options.data.kind, gate));
  } catch (error) {
    return errorResponse(error);
  }
}
