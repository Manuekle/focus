import { AppError, errorResponse } from "../../../../server/errors";
import { guardUpload } from "../../../../server/guard";
import { declaredLength } from "../../../../server/animation/http";
import { ingestCharacterImage } from "../../../../server/animation/image-input";
import { assertFlipbookEnabled, cleanupFlipbooks } from "../../../../server/animation/store";

// Raw-body upload of the character illustration, like video uploads: the
// server decodes the real bytes and keeps a normalized PNG working copy.
export async function POST(request: Request) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    void cleanupFlipbooks();
    const header = request.headers.get("x-focus-filename");
    let fileName = "";
    try {
      fileName = header ? decodeURIComponent(header) : "";
    } catch {
      throw new AppError("invalid_filename", 400, "The file name isn’t valid.");
    }
    const image = await ingestCharacterImage({ body: request.body, fileName, declaredBytes: declaredLength(request) });
    return Response.json(image, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
