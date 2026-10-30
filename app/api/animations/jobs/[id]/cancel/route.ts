import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { cancelAnimationJob } from "../../../../../../server/reference-motion/jobs";
import { assertReferenceMotionEnabled } from "../../../../../../server/reference-motion/store";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    return Response.json(await cancelAnimationJob((await params).id, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
