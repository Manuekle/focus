import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, stopGeneration } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    return Response.json(await stopGeneration((await params).id, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
