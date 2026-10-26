import { errorResponse } from "../../../../../server/errors";
import { getJobTracking } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await getJobTracking(id), { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return errorResponse(error);
  }
}
