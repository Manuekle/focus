import { NextResponse, type NextRequest } from "next/server";
import { RagError, searchKnowledge } from "@/lib/rag";
import { apiError, apiFailure, missingField, withApiErrors } from "@/lib/api-error";

// POST /api/knowledge/search — { query, limit? } → the closest chunks.
// Used by the Conocimiento page to let you check what the agent would
// actually retrieve before trusting it in a conversation.

export const maxDuration = 60;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { query?: unknown; limit?: unknown };
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
      : 5;

  try {
    const matches = await searchKnowledge(query, { limit });
    return NextResponse.json({ matches });
  } catch (error) {
    if (error instanceof RagError) {
      return apiError("unprocessable", { detail: error.message });
    }
    console.error("[knowledge] search failed", error);
    return apiFailure(error);
  }
});
