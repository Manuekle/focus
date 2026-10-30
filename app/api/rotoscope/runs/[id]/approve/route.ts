import { ApproveAttemptSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { approveAttempt, assertRotoscopeEnabled } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** A person accepts a rejected attempt of the frame the firewall stopped on. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const body = ApproveAttemptSchema.safeParse(await readJsonBody(request));
    if (!body.success) throw new AppError("INPUT_INVALID", 400, "Choose a frame and an attempt.");
    return Response.json(await approveAttempt((await params).id, user.id, body.data.frame, body.data.attempt));
  } catch (error) {
    return errorResponse(error);
  }
}
