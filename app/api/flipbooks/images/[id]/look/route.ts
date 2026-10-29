import { errorResponse } from "../../../../../../server/errors";
import { guardChatRequest } from "../../../../../../server/guard";
import { paidGate } from "../../../../../../server/animation/http";
import { readUploadedImage } from "../../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/**
 * What Focus sees in an upload: the character, the scene, motions that suit
 * it, and its layers. Read once per upload (one Muse Spark call, one SAM
 * frame), then served from the upload's folder. No free edit is spent.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const gate = paidGate(request, { charge: false });
    const look = await readUploadedImage(id, async (cost) => {
      await guardChatRequest(request);
      await gate(cost);
    });
    return Response.json(look, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
