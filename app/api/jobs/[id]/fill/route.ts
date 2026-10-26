import { errorResponse } from "../../../../../server/errors";
import { fillGaps } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

/** Explicit, paid: completes the selected subject's tracking on frames SAM missed. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await fillGaps(id), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
