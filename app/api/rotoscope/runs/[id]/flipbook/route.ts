import { OpenFlipbookOptionsSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { readJsonBody } from "../../../../../../server/guard";
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
    const options = OpenFlipbookOptionsSchema.safeParse(await readJsonBody(request));
    if (!options.success) throw new AppError("INPUT_INVALID", 400, "Choose whether to bring the video’s sound.");
    return Response.json(await openInFlipbook((await params).id, user.id, { sound: options.data.sound ?? false }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
