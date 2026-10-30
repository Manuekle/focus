import { AssetKindSchema } from "../../../../shared/reference-motion";
import { AppError, errorResponse } from "../../../../server/errors";
import { guardUpload } from "../../../../server/guard";
import { requireUser } from "../../../../server/auth/require";
import { declaredLength } from "../../../../server/animation/http";
import { ingestAsset } from "../../../../server/reference-motion/assets";
import { assertReferenceMotionEnabled, cleanupReferenceMotion } from "../../../../server/reference-motion/store";

// Raw-body upload of the character image (?kind=character) or the movement
// video (?kind=driving). The server decodes the real bytes and keeps one
// normalized copy; nothing reaches the GPU until a job is created.
export async function POST(request: Request) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    await cleanupReferenceMotion();
    const kind = AssetKindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
    if (!kind.success) throw new AppError("INPUT_INVALID", 400, "Choose a character image or a movement video.");
    await guardUpload(request);
    let fileName = "";
    try { fileName = decodeURIComponent(request.headers.get("x-focus-filename") ?? ""); } catch { throw new AppError("invalid_filename", 400, "The file name isn’t valid."); }
    const asset = await ingestAsset({ kind: kind.data, ownerId: user.id, body: request.body, declaredBytes: declaredLength(request), fileName });
    return Response.json(asset, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
