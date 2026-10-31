import { AppError, errorResponse } from "../../../../server/errors";
import { guardChatRequest, readJsonBody } from "../../../../server/guard";
import { currentUser } from "../../../../server/auth/users";
import { guideFlipbookSetup } from "../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../server/animation/store";
import { GuideRequestSchema } from "../../../../shared/flipbook-onboarding";

/**
 * One turn of the guided setup: the animator's words in, Muse Spark's question
 * or finished settings out. Uses the chat window like the movement chat;
 * nothing is drawn and no drawing or free edit is spent. A saved character
 * is read only for its signed-in owner.
 */
export async function POST(request: Request) {
  try {
    assertFlipbookEnabled();
    const parsed = GuideRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_guide", 400, "That message isn’t valid.");
    await guardChatRequest(request);
    const user = parsed.data.characterSource ? await currentUser(request) : null;
    return Response.json(await guideFlipbookSetup({ ...parsed.data, ownerId: user?.id ?? null, signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
