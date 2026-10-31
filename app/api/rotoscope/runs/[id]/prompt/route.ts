import { AnalyzePromptSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { activeRuns, analyzePrompt, assertRotoscopeEnabled, framePrompt } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };
const positive = (value: string | null) => (value && /^\d{1,5}$/.test(value) ? Number(value) : null);

/** A frame's Muse Image prompt: the attempt's when it kept one, else the one its next drawing gets. No AI call. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    const frame = positive(query.get("frame"));
    if (!frame) throw new AppError("INPUT_INVALID", 400, "Choose a frame.");
    return Response.json(await framePrompt((await params).id, user.id, frame, positive(query.get("attempt"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Muse Spark reads an edited prompt against the frame's images and an attempt's drawing: one model call, nothing drawn. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const body = AnalyzePromptSchema.safeParse(await readJsonBody(request));
    if (!body.success) throw new AppError("INPUT_INVALID", 400, "We couldn’t read this prompt.");
    await guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { charge: false, models: ["planner"] });
    return Response.json(await analyzePrompt((await params).id, user.id, body.data));
  } catch (error) {
    return errorResponse(error);
  }
}
