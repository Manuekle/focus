import { errorResponse, AppError } from "../../../server/errors";
import { guardUpload } from "../../../server/guard";
import { cleanupJobs } from "../../../server/jobs";
import { ingestVideo } from "../../../server/videos";

// Raw-body upload: the browser sends the file itself, so the server can stream
// it to disk and enforce the size limit without buffering a multipart form.
export async function POST(request: Request) {
  try {
    guardUpload(request);
    void cleanupJobs();
    if (!request.body) throw new AppError("empty_file", 400, "No file was received. Choose a file and try again.");
    const header = request.headers.get("x-focus-filename");
    let fileName = "";
    try {
      fileName = header ? decodeURIComponent(header) : "";
    } catch {
      throw new AppError("invalid_filename", 400, "The file name isn’t valid.");
    }
    const length = Number(request.headers.get("content-length"));
    const asset = await ingestVideo({
      body: request.body,
      fileName,
      declaredBytes: Number.isFinite(length) && length > 0 ? length : undefined,
    });
    return Response.json(asset, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
