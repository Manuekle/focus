import { ExportRequestSchema } from "../../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardRender, readJsonBody } from "../../../../../server/guard";
import { exportFlipbook } from "../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../server/animation/access";

type Context = { params: Promise<{ id: string }> };

/** Renders and verifies one export of the current frames. Local work only; identical settings reuse the file. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    await requireFlipbookAccess(request, id);
    const parsed = ExportRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_export", 400, "Those export settings aren’t valid.");
    const { flipbook, record } = await exportFlipbook(id, parsed.data, { signal: request.signal, beforeRender: () => guardRender(request) });
    return Response.json({ flipbook, record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
