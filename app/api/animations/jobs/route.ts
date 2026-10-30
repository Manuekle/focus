import { CreateJobRequestSchema } from "../../../../shared/reference-motion";
import { AppError, errorResponse } from "../../../../server/errors";
import { readJsonBody } from "../../../../server/guard";
import { requireUser } from "../../../../server/auth/require";
import { renderGate } from "../../../../server/reference-motion/http";
import { createAnimationJob } from "../../../../server/reference-motion/jobs";
import { assertReferenceMotionEnabled, listJobs } from "../../../../server/reference-motion/store";

/** The signed-in user's renders, most recent first. */
export async function GET(request: Request) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    return Response.json(await listJobs(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Starts a render. The same idempotencyKey returns the job it already created. */
export async function POST(request: Request) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    const input = CreateJobRequestSchema.safeParse(await readJsonBody(request));
    if (!input.success) throw new AppError("INPUT_INVALID", 400, "Choose a character, a movement video and a segment of up to 3 seconds.");
    return Response.json(await createAnimationJob(user.id, input.data, renderGate(request, user.id)), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
