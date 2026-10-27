import { errorResponse } from "../../../../../../server/errors";
import { guardChatRequest } from "../../../../../../server/guard";
import { paidGate } from "../../../../../../server/animation/http";
import { findLayers, readInventory } from "../../../../../../server/animation/living-pictures";
import { getCharacterImage } from "../../../../../../server/animation/image-input";
import { assertFlipbookEnabled } from "../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** What was found in the upload that can move, or null before anyone looked. Free. */
export async function GET(_request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    await getCharacterImage(id);
    return Response.json({ inventory: await readInventory(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Finds what can move: one Muse Spark call naming the parts, one SAM frame
 * per part. Done once per upload, then served from its folder.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const gate = paidGate(request);
    const inventory = await findLayers(id, async (cost) => {
      guardChatRequest(request);
      await gate(cost);
    });
    return Response.json({ inventory }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
