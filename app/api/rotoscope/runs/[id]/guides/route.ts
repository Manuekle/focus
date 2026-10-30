import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, rebuildGuides } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** Redraws the run's pose guides with the current guide code; local work, no AI call. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    return Response.json(await rebuildGuides((await params).id, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
