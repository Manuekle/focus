import { errorResponse } from "../../../../server/errors";
import { requireUser } from "../../../../server/auth/require";
import { assertReferenceMotionEnabled } from "../../../../server/reference-motion/store";
import { services } from "../../../../server/reference-motion/jobs";

/** Whether the GPU worker is configured, awake and which engines it can run. */
export async function GET(request: Request) {
  try {
    assertReferenceMotionEnabled();
    await requireUser(request);
    return Response.json(await services.availability(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
