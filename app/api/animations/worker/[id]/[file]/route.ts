import { InputNameSchema, OutputNameSchema } from "../../../../../../shared/reference-motion";
import { AppError, errorResponse } from "../../../../../../server/errors";
import { serveFile } from "../../../../../../server/serve-file";
import { receiveWorkerOutput, workerInput } from "../../../../../../server/reference-motion/jobs";
import { verifySignedRequest } from "../../../../../../server/reference-motion/signing";
import { assertReferenceMotionEnabled, parseJobId } from "../../../../../../server/reference-motion/store";

// The GPU worker's only way in: a signed, expiring URL per job, attempt, file
// and method. No session, no listing, nothing outside the job's own files.

type Context = { params: Promise<{ id: string; file: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const { id, file } = await params;
    const name = InputNameSchema.safeParse(file);
    if (!name.success) throw new AppError("forbidden", 403, "This link is invalid or has expired.");
    const { attempt } = verifySignedRequest({ method: "GET", jobId: parseJobId(id), name: name.data }, new URL(request.url).searchParams);
    const input = await workerInput(id, attempt, name.data);
    return serveFile(request, input.file, input.type);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    assertReferenceMotionEnabled();
    const { id, file } = await params;
    const name = OutputNameSchema.safeParse(file);
    if (!name.success) throw new AppError("forbidden", 403, "This link is invalid or has expired.");
    const { attempt } = verifySignedRequest({ method: "PUT", jobId: parseJobId(id), name: name.data }, new URL(request.url).searchParams);
    return Response.json(await receiveWorkerOutput(id, attempt, name.data, request.body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
