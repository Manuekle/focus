import { NextResponse, type NextRequest } from "next/server";
import { findMedia } from "@/lib/media-library";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// POST /api/media/search — { query, limit?, kind? } → the closest assets.
// Mirrors /api/knowledge/search: the Conocimiento page uses it so the owner
// can check that "fotos del sillón de roble" actually reaches the right file
// before a customer asks the same thing.

export const maxDuration = 60;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { query?: unknown; limit?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return missingField("query");

  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.min(Math.max(Math.trunc(body.limit), 1), 20)
      : 6;

  const kind =
    body.kind === "image" || body.kind === "video" || body.kind === "audio" ? body.kind : undefined;

  const matches = await findMedia(query, { limit, kind });
  return NextResponse.json({ matches });
});
