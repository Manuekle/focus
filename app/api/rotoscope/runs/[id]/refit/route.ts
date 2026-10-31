import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, refit } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** Lays the run out on the video person's own figure and moves its drawings onto it. Local work, no AI call. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    return Response.json(await refit((await params).id, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
