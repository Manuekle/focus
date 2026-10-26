import { NextResponse, type NextRequest } from "next/server";
import { listDocuments } from "@/lib/knowledge-store";
import {
  createFolder,
  deleteFolder,
  listAssets,
  listFolders,
  updateFolder,
} from "@/lib/media-store";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// GET    /api/media/folders     — folders with their document + asset counts
// POST   /api/media/folders     — { name, description? }
// PATCH  /api/media/folders     — { id, name?, description? }
// DELETE /api/media/folders?id= — removes the folder; its contents fall to root

export const GET = withApiErrors(async function GET() {
  const [folders, assets, documents] = await Promise.all([
    listFolders(),
    listAssets(),
    listDocuments(),
  ]);

  // Counted here rather than stored on the folder: a count kept in the file
  // is one more thing that can drift out of sync with what's actually in it.
  return NextResponse.json({
    folders: folders.map((folder) => ({
      ...folder,
      assets: assets.filter((asset) => asset.folder_id === folder.id).length,
      documents: documents.filter((doc) => doc.folder_id === folder.id).length,
    })),
  });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return missingField("name");
  if (name.length > 60) {
    return apiError("invalid_field", { field: "name", message: "The folder name is too long." });
  }

  const existing = await listFolders();
  if (existing.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
    return apiError("conflict", { message: "A folder with that name already exists." });
  }

  const folder = await createFolder({
    name,
    description: typeof body.description === "string" ? body.description : "",
  });
  return NextResponse.json({ folder });
});

export const PATCH = withApiErrors(async function PATCH(request: NextRequest) {
  let body: { id?: unknown; name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return missingField("id");

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const description = typeof body.description === "string" ? body.description : undefined;
  if (name === undefined && description === undefined) return apiError("nothing_to_update");
  if (name !== undefined && !name) return missingField("name");

  const folder = await updateFolder(id, { name, description });
  if (!folder) return apiError("not_found");
  return NextResponse.json({ folder });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return missingField("id");

  const deleted = await deleteFolder(id);
  if (!deleted) return apiError("not_found");
  return NextResponse.json({ success: true });
});
