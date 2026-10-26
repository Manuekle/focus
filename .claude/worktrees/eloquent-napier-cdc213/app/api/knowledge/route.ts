import { NextResponse, type NextRequest } from "next/server";
import { resolveEmbeddingModel } from "@/lib/ai-provider";
import { deleteDocument, listDocuments, setDocumentFolder } from "@/lib/knowledge-store";
import { listFolders } from "@/lib/media-store";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, RagError, ingestFile } from "@/lib/rag";
import { readUploadRequest } from "@/lib/upload-request";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// GET    /api/knowledge      — list indexed documents + folders + embedding status
// POST   /api/knowledge      — multipart upload; indexes each file
// PATCH  /api/knowledge      — { id, folder_id } to file a document
// DELETE /api/knowledge?id=  — remove a document and its chunks

// Embedding a large PDF is a few seconds of model calls, well past the
// default for a static route.
export const maxDuration = 300;

export const GET = withApiErrors(async function GET() {
  const [documents, folders] = await Promise.all([listDocuments(), listFolders()]);
  const embedding = resolveEmbeddingModel();
  return NextResponse.json({
    documents,
    folders,
    embeddings: embedding
      ? { available: true, model: embedding.modelId, route: embedding.route }
      : { available: false },
    limits: { maxFileBytes: MAX_FILE_BYTES, accept: ACCEPT_ATTRIBUTE },
  });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  // Multipart from an install without a bucket, or `{ staged }` once the
  // browser has put the files in the bucket itself (see lib/staged-uploads.ts).
  const upload = await readUploadRequest(request, MAX_FILE_BYTES);
  if (!upload) return apiError("unsupported_format", { message: "A multipart form was expected." });

  const files = upload.files;
  if (files.length === 0) {
    return apiError("no_file");
  }

  const folderRaw = upload.field("folderId");
  const folderId = folderRaw && folderRaw !== "root" ? folderRaw : null;

  // Per-file results rather than all-or-nothing: one unreadable PDF in a
  // batch shouldn't discard the documents that indexed cleanly.
  const indexed = [];
  const failed = [];
  for (const file of files) {
    try {
      const document = await ingestFile({
        name: file.name,
        mime: file.type,
        bytes: await file.read(),
        folderId,
      });
      indexed.push(document);
    } catch (error) {
      // `key`/`params` are what the browser renders; `error` is the English
      // fallback for anything reading this response raw.
      failed.push(
        error instanceof RagError
          ? { name: file.name, error: error.message, key: error.key, params: error.params }
          : {
              name: file.name,
              error: "The file couldn't be indexed. Check the model credentials.",
              key: "ragError.indexFailed",
            },
      );
      if (!(error instanceof RagError)) console.error("[knowledge] ingest failed", error);
    } finally {
      await file.release();
    }
  }

  return NextResponse.json(
    { documents: indexed, failed },
    { status: indexed.length === 0 ? 422 : 200 },
  );
});

export const PATCH = withApiErrors(async function PATCH(request: NextRequest) {
  let body: { id?: unknown; folder_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return missingField("id");
  if (body.folder_id !== null && typeof body.folder_id !== "string") {
    return missingField("folder_id");
  }

  const folderId =
    body.folder_id === null || body.folder_id === "" || body.folder_id === "root"
      ? null
      : body.folder_id;

  const document = await setDocumentFolder(id, folderId);
  if (!document) return apiError("not_found");
  return NextResponse.json({ document });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return missingField("id");

  const deleted = await deleteDocument(id);
  if (!deleted) return apiError("not_found");
  return NextResponse.json({ success: true });
});
