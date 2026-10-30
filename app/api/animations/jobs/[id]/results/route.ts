import { OutputNameSchema } from "../../../../../../shared/reference-motion";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { serveFile } from "../../../../../../server/serve-file";
import { outputFile } from "../../../../../../server/reference-motion/jobs";
import { assertReferenceMotionEnabled, getOwnedJob } from "../../../../../../server/reference-motion/store";

type Context = { params: Promise<{ id: string }> };

/** One verified output of a completed render, to its owner only. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const user = await requireUser(request);
    const job = await getOwnedJob((await params).id, user.id);
    const search = new URL(request.url).searchParams;
    const name = OutputNameSchema.safeParse(search.get("file"));
    if (!name.success) throw new AppError("media_not_found", 404, "This file is no longer available.");
    // Diagnostics are useful mid-run; the animation itself only once verified.
    if (job.status !== "completed") throw new AppError("media_not_found", 404, "This render isn’t finished.");
    const type = job.outputs.find((output) => output.name === name.data)?.type ?? "application/octet-stream";
    return serveFile(request, outputFile(job, name.data), type, search.get("download") === "1" ? `focus-${job.id.slice(0, 8)}-${name.data}` : undefined);
  } catch (error) {
    return errorResponse(error);
  }
}
