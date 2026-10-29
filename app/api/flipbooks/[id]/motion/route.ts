import path from "node:path";
import { requireFlipbookAccess } from "../../../../../server/animation/access";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";
import { declaredLength, paidGate } from "../../../../../server/animation/http";
import { AttachMotionSchema, attachMotionReference, motionDir, uploadMotionReference } from "../../../../../server/animation/motion-reference";
import { AppError, errorResponse } from "../../../../../server/errors";
import { guardUpload, readJsonBody } from "../../../../../server/guard";
import { serveFile } from "../../../../../server/serve-file";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const book = await requireFlipbookAccess(request, (await params).id);
    const version = new URL(request.url).searchParams.get("v");
    const reference = [book.motionDraft, book.motionReference, ...(book.revisions ?? []).map((revision) => revision.motionReference)].find((entry) => entry?.version === version);
    if (!reference) throw new AppError("motion_not_found", 404, "This movement reference is no longer available.");
    return serveFile(request, path.join(motionDir(book.id, reference.version), "source.mp4"), "video/mp4");
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const book = await requireFlipbookAccess(request, (await params).id);
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const input = AttachMotionSchema.safeParse(await readJsonBody(request));
      if (!input.success) throw new AppError("invalid_motion_trim", 400, "Choose a valid start and a duration of 1–20 whole seconds.");
      return Response.json(await attachMotionReference(book.id, input.data, paidGate(request, { continuation: book.motionSource === "video" && !book.plan })), { status: 202 });
    }
    await guardUpload(request);
    let name = "Movement reference";
    try { name = decodeURIComponent(request.headers.get("X-Focus-Filename") ?? name); } catch { /* Display name only. */ }
    return Response.json(await uploadMotionReference(book.id, request.body, declaredLength(request), name));
  } catch (error) { return errorResponse(error); }
}
