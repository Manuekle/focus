import { errorResponse } from "../../../../../../../server/errors";
import { paidGate } from "../../../../../../../server/animation/http";
import { prepareBlink } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** Lets the character blink: one SAM frame finds the eyes, one Muse Image drawing shuts them. Done once per upload. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    return Response.json({ inventory: await prepareBlink(id, paidGate(request)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
