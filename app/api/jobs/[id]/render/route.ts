import { RenderRequestSchema } from "../../../../../shared/schemas";
import { AppError, errorResponse } from "../../../../../server/errors";
import { startRender } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

/** Re-renders with new effect parameters, reusing the stored masks. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const parsed = RenderRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError("invalid_params", 400, "Los ajustes del efecto no son válidos.");
    return Response.json(await startRender(id, parsed.data.params), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
