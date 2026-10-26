import { errorResponse, AppError } from "../../../server/errors";
import { ingestVideo } from "../../../server/videos";

// Raw-body upload: the browser sends the file itself, so the server can stream
// it to disk and enforce the size limit without buffering a multipart form.
export async function POST(request: Request) {
  try {
    if (!request.body) throw new AppError("empty_file", 400, "No recibimos ningún archivo.");
    const header = request.headers.get("x-focus-filename");
    const fileName = header ? decodeURIComponent(header) : "";
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
