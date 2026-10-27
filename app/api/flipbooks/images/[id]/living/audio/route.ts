import { errorResponse } from "../../../../../../../server/errors";
import { guardUpload } from "../../../../../../../server/guard";
import { declaredLength } from "../../../../../../../server/animation/http";
import { readTrack, uploadTrack } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/** The uploaded track for "Animate as is", or null. */
export async function GET(_request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    return Response.json({ track: await readTrack(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** A track to play under the animation: read with FFprobe, normalized to AAC, replacing the previous one. Local work only. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    guardUpload(request);
    let name = "";
    try {
      name = decodeURIComponent(request.headers.get("x-focus-filename") ?? "").trim();
    } catch {
      // A name that doesn't decode is only a label: the bytes are what is checked.
    }
    const track = await uploadTrack(id, request.body, declaredLength(request), name || "Track");
    return Response.json({ track }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
