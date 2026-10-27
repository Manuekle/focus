import { CreateFlipbookRequestSchema } from "../../../shared/flipbook";
import { AppError, errorResponse } from "../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../server/guard";
import { consumeFreeEdit } from "../../../server/quota";
import { anonymousId } from "../../../server/auth/session";
import { jsonWithCookies } from "../../../server/auth/routes";
import { currentUser } from "../../../server/auth/users";
import { requireUser } from "../../../server/auth/require";
import { createFlipbook, listFlipbooks } from "../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../server/animation/store";

/** The signed-in user's saved animations, most recent first. */
export async function GET(request: Request) {
  try {
    assertFlipbookEnabled();
    const user = await requireUser(request);
    return Response.json(await listFlipbooks(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

// Starts a flipbook: analysis, pose plan, reference, then the drawings, in the
// background. Signed in, it is saved to the account from the start; without an
// account it spends one free AI edit, like a video edit.
export async function POST(request: Request) {
  try {
    assertFlipbookEnabled();
    const parsed = CreateFlipbookRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === "poseId")) throw new AppError("invalid_pose", 400, "The posture couldn’t be planned. Describe the movement again.");
      throw new AppError("invalid_flipbook", 400, "Describe how your character should move (at least 3 characters).");
    }
    const user = await currentUser(request);
    const anon = user ? null : anonymousId(request);
    const flipbook = await createFlipbook({ ...parsed.data, ownerId: user?.id ?? null }, async (cost) => {
      await guardAiRequest(request, cost);
      if (anon) await consumeFreeEdit(request, anon.id);
    });
    return jsonWithCookies(flipbook, [anon?.setCookie ?? null], { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
