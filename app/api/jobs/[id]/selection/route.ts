import { SelectionRequestSchema } from "../../../../../shared/schemas";
import { AppError, errorResponse } from "../../../../../server/errors";
import { readJsonBody } from "../../../../../server/guard";
import { reopenSelection, setSelection } from "../../../../../server/jobs";

type Context = { params: Promise<{ id: string }> };

/** Confirms which tracked objects the effect applies to. No API call. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const parsed = SelectionRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_selection", 400, "Elige al menos un objeto.");
    return Response.json(await setSelection(id, parsed.data.objectIds));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Goes back to choosing, keeping the existing masks. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await reopenSelection(id));
  } catch (error) {
    return errorResponse(error);
  }
}
