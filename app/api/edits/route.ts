import { EditRequestSchema } from "../../../shared/schemas";
import { AppError, errorResponse } from "../../../server/errors";
import { createJob } from "../../../server/jobs";

// Explicit, user-triggered processing. Returns the job immediately; the
// editor polls /api/jobs/:id for progress.
export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => {
      throw new AppError("invalid_json", 400, "No pudimos leer la solicitud.");
    });
    const parsed = EditRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("invalid_edit", 400, "Describe el cambio con al menos 3 caracteres y elige un efecto.");
    }
    return Response.json(await createJob(parsed.data), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
