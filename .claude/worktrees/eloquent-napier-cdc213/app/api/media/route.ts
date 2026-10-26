import { NextResponse, type NextRequest } from "next/server";
import { resolveEmbeddingModel } from "@/lib/ai-provider";
import {
  MAX_BYTES_BY_KIND,
  MAX_MEDIA_BYTES,
  MEDIA_ACCEPT_ATTRIBUTE,
  MediaError,
  editMedia,
  ingestMedia,
} from "@/lib/media-library";
import { deleteAsset, getAsset, listAssets, listFolders } from "@/lib/media-store";
import { readUploadRequest } from "@/lib/upload-request";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// GET    /api/media            — assets (optionally one folder's)
// POST   /api/media            — multipart upload of photos/videos/audio
// PATCH  /api/media            — rename, re-describe, re-tag, or move an asset
// DELETE /api/media?id=        — remove an asset and its bytes
//
// The description matters more here than anywhere else in the app: it is what
// the agent searches when a customer asks "¿tenés fotos de X?", so the client
// asks for it on upload and this route re-embeds whenever it changes.

// Videos are up to 16 MB and every upload is embedded, so the default static
// route budget is not enough.
export const maxDuration = 300;

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const folderParam = params.get("folderId");
  // Absent means "everything"; "root" means the assets in no folder at all.
  const folderId =
    folderParam === null ? undefined : folderParam === "root" || folderParam === "" ? null : folderParam;

  const [assets, folders] = await Promise.all([listAssets({ folderId }), listFolders()]);
  const embedding = resolveEmbeddingModel();

  return NextResponse.json({
    assets,
    folders,
    embeddings: embedding
      ? { available: true, model: embedding.modelId, route: embedding.route }
      : { available: false },
    limits: { maxBytesByKind: MAX_BYTES_BY_KIND, accept: MEDIA_ACCEPT_ATTRIBUTE },
  });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  // Multipart from an install without a bucket, or `{ staged }` once the
  // browser has put the files in the bucket itself (see lib/staged-uploads.ts).
  const upload = await readUploadRequest(request, MAX_MEDIA_BYTES);
  if (!upload) return apiError("unsupported_format", { message: "A multipart form was expected." });

  const files = upload.files;
  if (files.length === 0) return apiError("no_file");

  const folderRaw = upload.field("folderId");
  const folderId = folderRaw && folderRaw !== "root" ? folderRaw : null;
  const description = upload.field("description") ?? "";
  const tagsRaw = upload.field("tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((tag) => tag.trim()).filter(Boolean) : [];

  // Per-file results, same as the knowledge upload: one oversized video in a
  // drop of twenty photos shouldn't discard the nineteen that fit.
  const stored = [];
  const failed = [];
  for (const file of files) {
    try {
      stored.push(
        await ingestMedia({
          name: file.name,
          mime: file.type,
          bytes: await file.read(),
          folderId,
          description,
          tags,
        }),
      );
    } catch (error) {
      failed.push(
        error instanceof MediaError
          ? { name: file.name, error: error.message, key: error.key, params: error.params }
          : { name: file.name, error: "The file couldn't be saved.", key: "mediaError.saveFailed" },
      );
      if (!(error instanceof MediaError)) console.error("[media] upload failed", error);
    } finally {
      await file.release();
    }
  }

  return NextResponse.json(
    { assets: stored, failed },
    { status: stored.length === 0 ? 422 : 200 },
  );
});

export const PATCH = withApiErrors(async function PATCH(request: NextRequest) {
  let body: {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    folder_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return missingField("id");

  const current = await getAsset(id);
  if (!current) return apiError("not_found");

  const patch: Parameters<typeof editMedia>[1] = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.description === "string") patch.description = body.description;
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.filter((tag): tag is string => typeof tag === "string");
  }
  if (body.folder_id === null || typeof body.folder_id === "string") {
    patch.folder_id = body.folder_id === "" || body.folder_id === "root" ? null : body.folder_id;
  }
  if (Object.keys(patch).length === 0) return apiError("nothing_to_update");

  const asset = await editMedia(id, patch, current);
  if (!asset) return apiError("not_found");
  return NextResponse.json({ asset });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return missingField("id");

  const deleted = await deleteAsset(id);
  if (!deleted) return apiError("not_found");
  return NextResponse.json({ success: true });
});
