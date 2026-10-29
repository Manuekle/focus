import { CreateEnsembleRequestSchema, CreateFlipbookRequestSchema } from "../../../shared/flipbook";
import { AppError, errorResponse } from "../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../server/guard";
import { anonymousId } from "../../../server/auth/session";
import { jsonWithCookies } from "../../../server/auth/routes";
import { currentUser } from "../../../server/auth/users";
import { requireUser } from "../../../server/auth/require";
import { createEnsemble, createFlipbook, listFlipbooks } from "../../../server/animation/flipbooks";
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
// background. Each request spends one lifetime generation, including signed-in
// users, whose work is saved to the account. A body with a `cast`
// is a scene of several saved characters, for as many seconds as it asks.
export async function POST(request: Request) {
  try {
    assertFlipbookEnabled();
    const body = await readJsonBody(request);
    if (body && typeof body === "object" && "cast" in body) {
      const scene = CreateEnsembleRequestSchema.safeParse(body);
      if (!scene.success) throw new AppError("invalid_flipbook", 400, "Pick two to four characters, describe what happens and choose how many seconds it lasts.");
      const user = await requireUser(request);
      const flipbook = await createEnsemble({ ...scene.data, ownerId: user.id }, (cost) => guardAiRequest(request, cost));
      return Response.json(flipbook, { status: 202 });
    }
    const parsed = CreateFlipbookRequestSchema.safeParse(body);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === "poseId")) throw new AppError("invalid_pose", 400, "The posture couldn’t be planned. Describe the movement again.");
      throw new AppError("invalid_flipbook", 400, "Describe how your character should move (at least 3 characters).");
    }
    const user = await currentUser(request);
    const anon = user ? null : anonymousId(request);
    const flipbook = await createFlipbook({ ...parsed.data, ownerId: user?.id ?? null }, async (cost) => {
      await guardAiRequest(request, cost);
    });
    return jsonWithCookies(flipbook, [anon?.setCookie ?? null], { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
