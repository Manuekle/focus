import { ImportMethodSchema } from "../../../../../../shared/reference-motion";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../../../../server/guard";
import { activeWorkCount } from "../../../../../../server/jobs";
import { requireUser } from "../../../../../../server/auth/require";
import { importToFlipbook } from "../../../../../../server/reference-motion/flipbook-import";
import { assertReferenceMotionEnabled } from "../../../../../../server/reference-motion/store";

type Context = { params: Promise<{ id: string }> };

/**
 * Opens a finished render in Flipbook, once per method. "muse" (default)
 * makes the render the movement reference that Muse Image draws every frame
 * from, guarded like any new flipbook; "background" imports the render's own
 * frames for free; "sam" is one SAM 3.1 video pass over them.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const method = ImportMethodSchema.safeParse((body as { method?: unknown }).method ?? "muse");
    if (!method.success) throw new AppError("INPUT_INVALID", 400, "Choose how the render opens in Flipbook.");
    const gate = (frames: number, options: { continuation?: boolean } = {}) => guardAiRequest(request, { activeJobs: activeWorkCount(), estimatedFrames: frames }, method.data === "sam" ? { models: ["segmentation"] } : options);
    return Response.json(await importToFlipbook((await params).id, user.id, method.data, gate), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
