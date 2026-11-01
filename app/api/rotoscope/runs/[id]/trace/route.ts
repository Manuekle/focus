import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, getTrace } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };
const positive = (value: string | null) => (value && /^\d{1,5}$/.test(value) ? Number(value) : null);

/** A frame's pipeline: every attempt's steps (inputs, prompt, drawing, measures, fidelity, review, decision) and the environment's guardrails. No AI call. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const frame = positive(new URL(request.url).searchParams.get("frame"));
    if (!frame) throw new AppError("INPUT_INVALID", 400, "Choose a frame.");
    return Response.json(await getTrace((await params).id, user.id, frame), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
