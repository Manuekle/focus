import { z } from "zod";
import { AppError, errorResponse } from "../../../../../server/errors";
import { requireUser } from "../../../../../server/auth/require";
import { assertRotoscopeEnabled, getBatch } from "../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** Every run of a test batch. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new AppError("batch_not_found", 404, "This test batch doesn’t exist.");
    return Response.json(await getBatch(id.data, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
