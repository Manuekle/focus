import { errorResponse } from "../../../server/errors";
import { usageSummary } from "../../../server/ai/usage";

/**
 * Usage diagnostics: API calls, cache hits, tokens and SAM frames. Open in
 * development; in production only with the X-Focus-Admin header matching
 * FOCUS_ADMIN_TOKEN (and hidden entirely when no token is configured).
 */
export async function GET(request: Request) {
  try {
    if (process.env.NODE_ENV === "production") {
      const token = process.env.FOCUS_ADMIN_TOKEN;
      if (!token || request.headers.get("x-focus-admin") !== token) return new Response("Not found", { status: 404 });
    }
    return Response.json(await usageSummary(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
