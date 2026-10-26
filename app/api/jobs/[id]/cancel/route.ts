import { errorResponse } from "../../../../../server/errors";
import { cancelJob } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await cancelJob(id));
  } catch (error) {
    return errorResponse(error);
  }
}
