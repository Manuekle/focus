import type { RotoscopeMedia } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { serveFile } from "../../../../../../server/serve-file";
import { assertRotoscopeEnabled, mediaFile } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };
const KINDS = new Set<RotoscopeMedia>(["source", "guide", "attempt", "frame", "character", "correction", "audio"]);
const positive = (value: string | null) => (value && /^\d{1,5}$/.test(value) ? Number(value) : undefined);

export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    const kind = query.get("kind") as RotoscopeMedia;
    if (!KINDS.has(kind)) throw new AppError("media_not_found", 404, "This file is no longer available.");
    const file = await mediaFile((await params).id, user.id, kind, positive(query.get("frame")), positive(query.get("attempt")));
    return await serveFile(request, file, kind === "audio" ? "audio/mp4" : "image/png");
  } catch (error) {
    return errorResponse(error);
  }
}
