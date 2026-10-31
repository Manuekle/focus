import { GenerateOptionsSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { activeRuns, assertRotoscopeEnabled, startGeneration } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/**
 * Starts drawing, or resumes at the first open frame after the firewall stopped. `{ dual }` adds Higgsfield's drawing;
 * `{ frame }` redraws only that frame; `{ frame, prompt, attempts: 1 }` draws it once with a prompt from the debug panel.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const options = GenerateOptionsSchema.safeParse(await readJsonBody(request));
    if (!options.success) throw new AppError("INPUT_INVALID", 400, "We couldn’t read these drawing options.");
    const gate = () => guardAiRequest(request, { activeJobs: activeRuns(), estimatedFrames: 0 }, { models: ["planner", "image"] });
    return Response.json(await startGeneration((await params).id, user.id, gate, { dual: options.data.dual, only: options.data.frame, renderer: options.data.renderer, prompt: options.data.prompt, attempts: options.data.attempts }));
  } catch (error) {
    return errorResponse(error);
  }
}
