import { GENERATORS, type GeneratorName, type RotoscopeMedia } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { serveFile } from "../../../../../../server/serve-file";
import { assertRotoscopeEnabled, mediaFile } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };
const KINDS = new Set<RotoscopeMedia>(["source", "guide", "attempt", "frame", "character", "scaled", "posesheet", "correction", "audio", "exposed", "labels", "mask", "overlay", "build", "scan", "drawn"]);
const positive = (value: string | null) => (value && /^\d{1,5}$/.test(value) ? Number(value) : undefined);
/** Rewritten under the same URL (a refit moves every drawing; the scaled sheet follows the measures): always revalidated. */
const CHANGING = new Set<RotoscopeMedia>(["attempt", "frame", "scaled", "posesheet", "overlay", "build", "scan", "drawn"]);

export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    const kind = query.get("kind") as RotoscopeMedia;
    if (!KINDS.has(kind)) throw new AppError("media_not_found", 404, "This file is no longer available.");
    const by = query.get("by");
    const file = await mediaFile((await params).id, user.id, kind, positive(query.get("frame")), positive(query.get("attempt")), GENERATORS.includes(by as GeneratorName) ? by as GeneratorName : undefined);
    return await serveFile(request, file, kind === "audio" ? "audio/mp4" : "image/png", undefined, { revalidate: CHANGING.has(kind) });
  } catch (error) {
    return errorResponse(error);
  }
}
