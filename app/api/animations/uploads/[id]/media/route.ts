import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { serveFile } from "../../../../../../server/serve-file";
import { assertReferenceMotionEnabled, assetFiles, getOwnedAsset } from "../../../../../../server/reference-motion/store";

type Context = { params: Promise<{ id: string }> };

/** The normalized upload, to its owner only. ?poster=1 for a video's first frame. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    const asset = await getOwnedAsset((await params).id, user.id);
    if (asset.kind === "driving" && new URL(request.url).searchParams.get("poster") === "1") return serveFile(request, assetFiles.poster(asset.id), "image/jpeg");
    return serveFile(request, assetFiles.media(asset), asset.mime);
  } catch (error) {
    return errorResponse(error);
  }
}
