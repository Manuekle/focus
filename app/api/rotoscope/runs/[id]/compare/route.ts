import { CompareOptionsSchema } from "../../../../../../shared/rotoscope";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { readJsonBody } from "../../../../../../server/guard";
import { requireUser } from "../../../../../../server/auth/require";
import { serveFile } from "../../../../../../server/serve-file";
import { assertRotoscopeEnabled, comparisonFile, exportCompare } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** The video and the approved drawings as one clip, rendered now (or found, if the same one was made before). Local work only. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const options = CompareOptionsSchema.safeParse(await readJsonBody(request));
    if (!options.success) throw new AppError("INPUT_INVALID", 400, "Choose a layout, a format and a size for the comparison.");
    return Response.json(await exportCompare((await params).id, user.id, options.data), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** A rendered clip, to watch (Range works) or, with `download=<name>`, to keep. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    const { file, type } = await comparisonFile((await params).id, user.id, query.get("file") ?? "");
    const download = query.get("download");
    return await serveFile(request, file, type, download === null ? undefined : download.replace(/[^\w.-]+/g, "_").slice(0, 120) || "comparison");
  } catch (error) {
    return errorResponse(error);
  }
}
