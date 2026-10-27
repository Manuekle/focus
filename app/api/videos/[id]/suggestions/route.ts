import { errorResponse } from "../../../../../server/errors";
import { suggestionsFor } from "../../../../../server/ai/suggest";
import { getVideo } from "../../../../../server/videos";

type Context = { params: Promise<{ id: string }> };

// Composer ideas for one clip. At most one Muse Spark call per video (cached);
// uploads are rate limited, so this is bounded by them.
export async function GET(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await suggestionsFor(await getVideo(id)));
  } catch (error) {
    return errorResponse(error);
  }
}
