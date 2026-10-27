import { CreateFlipbookRequestSchema } from "../../../shared/flipbook";
import { AppError, errorResponse } from "../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../server/guard";
import { consumeFreeEdit } from "../../../server/quota";
import { anonymousId } from "../../../server/auth/session";
import { jsonWithCookies } from "../../../server/auth/routes";
import { currentUser } from "../../../server/auth/users";
import { createFlipbook } from "../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../server/animation/store";

// Starts a flipbook: analysis, pose plan, reference, then the drawings, in the
// background. Without an account it spends one free AI edit, like a video edit.
export async function POST(request: Request) {
  try {
    assertFlipbookEnabled();
    const parsed = CreateFlipbookRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_flipbook", 400, "Describe how your character should move (at least 3 characters).");
    const user = await currentUser(request);
    const anon = user ? null : anonymousId(request);
    const flipbook = await createFlipbook(parsed.data, async (cost) => {
      await guardAiRequest(request, cost);
      if (anon) await consumeFreeEdit(request, anon.id);
    });
    return jsonWithCookies(flipbook, [anon?.setCookie ?? null], { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
