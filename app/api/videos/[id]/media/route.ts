import { errorResponse } from "../../../../../server/errors";
import { mediaResponse } from "../../../../../server/media-response";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return await mediaResponse(request, id);
  } catch (error) {
    return errorResponse(error);
  }
}
