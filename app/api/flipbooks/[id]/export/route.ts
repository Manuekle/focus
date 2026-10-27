import { ExportRequestSchema } from "../../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../../server/errors";
import { readJsonBody } from "../../../../../server/guard";
import { exportFlipbook } from "../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** Renders and verifies one export of the current frames. Local work only; identical settings reuse the file. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const parsed = ExportRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_export", 400, "Those export settings aren’t valid.");
    const { flipbook, record } = await exportFlipbook(id, parsed.data);
    return Response.json({ flipbook, record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
