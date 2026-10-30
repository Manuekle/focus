import { errorResponse } from "../../../../../server/errors";
import { requireUser } from "../../../../../server/auth/require";
import { assertReferenceMotionEnabled, getOwnedJob } from "../../../../../server/reference-motion/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    return Response.json(await getOwnedJob((await params).id, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
