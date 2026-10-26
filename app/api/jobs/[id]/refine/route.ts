import { RefineRequestSchema } from "../../../../../shared/schemas";
import { AppError, errorResponse } from "../../../../../server/errors";
import { refineWithPoint } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

/** A click on the preview, in normalized-video pixels and frame index. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const parsed = RefineRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_point", 400, "Punto no válido.");
    return Response.json(await refineWithPoint(id, parsed.data), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
