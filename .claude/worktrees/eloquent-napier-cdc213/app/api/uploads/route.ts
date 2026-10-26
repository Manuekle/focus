import { NextResponse, type NextRequest } from "next/server";
import { MAX_MEDIA_BYTES } from "@/lib/media-formats";
import { MAX_FILE_BYTES } from "@/lib/rag";
import { createStagedUpload, stagedUploadsAvailable } from "@/lib/staged-uploads";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// POST /api/uploads — { files: [{ name, type, size }] }
//
// Hands the browser somewhere to put each file so it never has to travel
// through a function. With a bucket the answer is `{ direct: true, uploads }`,
// one signed URL per file in the order sent; the browser PUTs each file there
// and then finalizes on the route that owns the file (`/api/media`,
// `/api/knowledge`) by naming the upload ids. Without a bucket the answer is
// `{ direct: false }` and the browser sends the multipart request it always did.
//
// This only refuses what cannot possibly be accepted. Type, extension and the
// per-kind size caps are enforced where the bytes are read back, on the bytes
// that were actually uploaded.

const MAX_FILES = 20;
const CEILING = Math.max(MAX_MEDIA_BYTES, MAX_FILE_BYTES);

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { files?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const requested = body.files;
  if (!Array.isArray(requested) || requested.length === 0) return missingField("files");
  if (requested.length > MAX_FILES) return apiError("invalid_body", { field: "files" });

  for (const entry of requested) {
    const size = (entry as { size?: unknown } | null)?.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      return apiError("invalid_body", { field: "files" });
    }
    if (size > CEILING) return apiError("too_large");
  }

  if (!(await stagedUploadsAvailable())) return NextResponse.json({ direct: false });

  const uploads = [];
  for (const entry of requested) {
    const type = typeof (entry as { type?: unknown }).type === "string" ? (entry as { type: string }).type : "";
    const staged = await createStagedUpload();
    // A bucket that was there a moment ago and is not now: fall back rather
    // than hand out half a batch.
    if (!staged) return NextResponse.json({ direct: false });
    uploads.push({
      uploadId: staged.uploadId,
      url: staged.url,
      // The browser sends this verbatim; the object is stored under it.
      headers: { "content-type": type || "application/octet-stream" },
    });
  }

  return NextResponse.json({ direct: true, uploads });
});
