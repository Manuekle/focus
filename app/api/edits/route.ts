import { EditRequestSchema } from "../../../shared/schemas";
import { AppError, errorResponse } from "../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../server/guard";
import { createJob } from "../../../server/jobs";

// Explicit, user-triggered processing. Returns the job immediately; the
// editor polls /api/jobs/:id for progress.
export async function POST(request: Request) {
  try {
    const parsed = EditRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError("invalid_edit", 400, "Describe el cambio con al menos 3 caracteres y elige un efecto.");
    }
    return Response.json(await createJob(parsed.data, (cost) => guardAiRequest(request, cost)), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
