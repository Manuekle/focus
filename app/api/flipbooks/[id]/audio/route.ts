import { requireFlipbookAccess } from "../../../../../server/animation/access";
import { assertFlipbookEnabled, updateFlipbook } from "../../../../../server/animation/store";
import { declaredLength } from "../../../../../server/animation/http";
import { trackPath, updateTrack, uploadFlipbookTrack } from "../../../../../server/animation/flipbook-audio";
import { errorResponse, AppError } from "../../../../../server/errors";
import { guardUpload, readJsonBody } from "../../../../../server/guard";
import { serveFile } from "../../../../../server/serve-file";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const book = await requireFlipbookAccess(request, (await params).id);
    if (!book.audio || new URL(request.url).searchParams.get("v") !== book.audio.version) throw new AppError("audio_not_found", 404, "This track is no longer available.");
    return serveFile(request, trackPath(book.id, book.audio.version), "audio/mp4");
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const book = await requireFlipbookAccess(request, (await params).id);
    guardUpload(request);
    let name = "Audio track";
    try { name = decodeURIComponent(request.headers.get("X-Focus-Filename") ?? name); } catch { /* Display name only. */ }
    return Response.json(await uploadFlipbookTrack(book.id, request.body, declaredLength(request), name));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const book = await requireFlipbookAccess(request, (await params).id);
    return Response.json(await updateTrack(book.id, await readJsonBody(request)));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const book = await requireFlipbookAccess(request, (await params).id);
    return Response.json(await updateFlipbook(book.id, (current) => ({ ...current, audio: null }), { evenIfCanceled: true }));
  } catch (error) { return errorResponse(error); }
}
