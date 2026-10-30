import { ExtendOptionsSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, extendRunBy } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** Adds the next `{ seconds }` of the video as open frames; local work, no AI call. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const options = ExtendOptionsSchema.safeParse(await readJsonBody(request));
    if (!options.success) throw new AppError("INPUT_INVALID", 400, "Choose how many seconds to add.");
    return Response.json(await extendRunBy((await params).id, user.id, options.data.seconds));
  } catch (error) {
    return errorResponse(error);
  }
}
