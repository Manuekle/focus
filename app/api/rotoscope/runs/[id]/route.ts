import { UpdateRunSchema } from "../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../server/errors";
import { readJsonBody } from "../../../../../server/guard";
import { requireUser } from "../../../../../server/auth/require";
import { assertRotoscopeEnabled, deleteRun, getRun, updateRun } from "../../../../../server/rotoscope/service";

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

/** Renames the run, or changes the character's measures for its next drawings. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const parsed = UpdateRunSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("INPUT_INVALID", 400, "Enter a name of up to 80 characters, or heights of 50–250 cm and a weight of 10–300 kg.");
    return Response.json(await updateRun((await params).id, user.id, parsed.data), { headers: { "Cache-Control": "no-store" } });
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
