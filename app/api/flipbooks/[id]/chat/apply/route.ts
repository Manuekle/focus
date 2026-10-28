import { ApplyPoseChangesRequestSchema } from "../../../../../../shared/flipbook-chat";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { readJsonBody } from "../../../../../../server/guard";
import { paidGate } from "../../../../../../server/animation/http";
import { applyPoseChanges } from "../../../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../../../server/animation/access";
import { readProposal } from "../../../../../../server/animation/proposals";

type Context = { params: Promise<{ id: string }> };

/** Redraws the frames of an approved proposal with their new instructions. Paid: same guards and budget as a frame redraw. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const current = await requireFlipbookAccess(request, id);
    const parsed = ApplyPoseChangesRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_action", 400, "That change isn’t valid.");
    if (current.sequence && !parsed.data.proposalId) throw new AppError("proposal_required", 400, "Apply the stored motion proposal so its revision can be checked.");
    const changes = parsed.data.proposalId ? await readProposal(current, parsed.data.proposalId) : parsed.data.changes!;
    const flipbook = await applyPoseChanges(id, changes, { confirmExtra: parsed.data.confirmExtra }, paidGate(request));
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
