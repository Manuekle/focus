import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, openInFlipbook } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/**
 * The one-way bridge: the run's approved frames become a new Flipbook. Local
 * work only (cut-out and registration), so no paid-work gate.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    return Response.json(await openInFlipbook((await params).id, user.id), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
