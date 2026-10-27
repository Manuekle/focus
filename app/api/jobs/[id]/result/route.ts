import { AppError, errorResponse } from "../../../../../server/errors";
import { resultFile } from "../../../../../server/jobs";
import { serveFile } from "../../../../../server/serve-file";

type Context = { params: Promise<{ id: string }> };

/** The edited MP4 (never the source), or the before/after comparison stream. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const search = new URL(request.url).searchParams;
    const kind = search.get("kind") ?? "output";
    if (kind !== "output" && kind !== "compare") throw new AppError("invalid_kind", 400, "Tipo de archivo desconocido.");
    const file = await resultFile(id, kind, search.get("r") ?? undefined);
    return await serveFile(request, file.path, "video/mp4", kind === "output" && search.get("download") === "1" ? file.downloadName : undefined);
  } catch (error) {
    return errorResponse(error);
  }
}
