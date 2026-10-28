import { errorResponse } from "../../../../../../../server/errors";
import { paidGate } from "../../../../../../../server/animation/http";
import { separateLivingScene } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/**
 * Takes the character out of the picture for the "depth" camera: free for a
 * plain or transparent background, one Muse Image drawing for a detailed one.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    return Response.json({ inventory: await separateLivingScene(id, paidGate(request)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
