import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { retryAnimationJob } from "../../../../../../server/reference-motion/jobs";
import { assertReferenceMotionEnabled } from "../../../../../../server/reference-motion/store";

type Context = { params: Promise<{ id: string }> };

/** Idempotent on the Idempotency-Key header: the same key retries once. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    const key = request.headers.get("idempotency-key") ?? "";
    if (!/^[\w-]{8,80}$/.test(key)) throw new AppError("INPUT_INVALID", 400, "Missing Idempotency-Key.");
    return Response.json(await retryAnimationJob((await params).id, user.id, key), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
