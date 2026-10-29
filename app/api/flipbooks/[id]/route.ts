import { FlipbookActionSchema, UpdateFlipbookRequestSchema } from "../../../../shared/flipbook";
import { AppError, errorResponse } from "../../../../server/errors";
import { guardChatRequest, readJsonBody } from "../../../../server/guard";
import { requireUser } from "../../../../server/auth/require";
import { paidGate } from "../../../../server/animation/http";
import {
  cancelFlipbook,
  changeReference,
  createScene,
  drawInbetweens,
  generateBackground,
  generateMissing,
  enhanceFlagged,
  retryPreparation,
  reorderFrames,
  reviewFlipbook,
  saveFlipbook,
  saveLook,
  unsaveFlipbook,
  reviseSequence,
  restoreSequenceRevision,
} from "../../../../server/animation/flipbooks";
import { assertFlipbookEnabled } from "../../../../server/animation/store";
import { requireFlipbookAccess } from "../../../../server/animation/access";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    return Response.json(await requireFlipbookAccess(request, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Flipbook-wide actions. Paid ones pass the same guards as a new edit. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    await requireFlipbookAccess(request, id);
    const parsed = FlipbookActionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_action", 400, "That action isn’t valid.");
    const action = parsed.data;
    const gate = paidGate(request);
    const flipbook =
      action.action === "sequence" ? await reviseSequence(id, action.settings, gate)
      : action.action === "enhance_flagged" ? await enhanceFlagged(id, action.confirmExtra === true, gate)
      : action.action === "retry" ? await retryPreparation(id, action.confirmExtra === true, gate)
      : action.action === "revision" ? await restoreSequenceRevision(id, action.id)
      : action.action === "generate" ? await generateMissing(id, action.confirmExtra === true, gate)
      : action.action === "inbetweens" ? await drawInbetweens(id, action.confirmExtra === true, gate, action.drawingFps)
      : action.action === "reorder" ? await reorderFrames(id, action.order)
      : action.action === "reference" ? await changeReference(id, action.kind, { confirmExtra: action.confirmExtra }, gate)
      : action.action === "scene" ? await createScene(id, action.confirmExtra === true, gate)
      : action.action === "background" ? await generateBackground(id, { prompt: action.prompt || undefined, confirmExtra: action.confirmExtra === true }, gate)
      : action.action === "look" ? await saveLook(id, { settings: action.settings, background: action.background })
      : action.action === "review" ? (guardChatRequest(request), await reviewFlipbook(id))
      : await cancelFlipbook(id);
    return Response.json(flipbook, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Saves the animation to the signed-in account (claiming one made before signing in) and renames it. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const user = await requireUser(request);
    await requireFlipbookAccess(request, (await params).id);
    const parsed = UpdateFlipbookRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_flipbook", 400, "That name isn’t valid.");
    return Response.json(await saveFlipbook((await params).id, user.id, parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Removes the animation from the account; it then expires within a day. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const user = await requireUser(request);
    await requireFlipbookAccess(request, (await params).id);
    await unsaveFlipbook((await params).id, user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
