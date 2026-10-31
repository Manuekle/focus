import { MappingCorrectionSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, correctMapping, diagnoseMapping, getMapping } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };
const positive = (value: string | null) => (value && /^\d{1,5}$/.test(value) ? Number(value) : null);

/** An attempt's character-mapping diagnostics, for the overlay inspector. Local files only, no AI call. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    const [frame, attempt] = [positive(query.get("frame")), positive(query.get("attempt"))];
    if (!frame || !attempt) throw new AppError("INPUT_INVALID", 400, "Choose a frame and an attempt.");
    return Response.json(await getMapping((await params).id, user.id, frame, attempt));
  } catch (error) {
    return errorResponse(error);
  }
}

/** A person's correction of a frame's target joints; the frame's next drawing deforms to them. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const body = MappingCorrectionSchema.safeParse(await readJsonBody(request));
    if (!body.success) throw new AppError("INPUT_INVALID", 400, "We couldn’t read this correction.");
    return Response.json(await correctMapping((await params).id, user.id, body.data));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Measures a frame's attempts drawn before the mapping engine (DWPose on this server, no AI call). */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    const [frame, attempt] = [positive(query.get("frame")), positive(query.get("attempt"))];
    if (!frame || !attempt) throw new AppError("INPUT_INVALID", 400, "Choose a frame and an attempt.");
    return Response.json(await diagnoseMapping((await params).id, user.id, frame, attempt));
  } catch (error) {
    return errorResponse(error);
  }
}
