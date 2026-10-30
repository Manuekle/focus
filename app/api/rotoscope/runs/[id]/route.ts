import { RenameRunSchema } from "../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../server/errors";
import { readJsonBody } from "../../../../../server/guard";
import { requireUser } from "../../../../../server/auth/require";
import { assertRotoscopeEnabled, deleteRun, getRun, renameRun } from "../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    return Response.json(await getRun((await params).id, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Renames the run. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const parsed = RenameRunSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("INPUT_INVALID", 400, "Enter a name of up to 80 characters.");
    return Response.json(await renameRun((await params).id, user.id, parsed.data.name), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    await deleteRun((await params).id, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
