import { errorResponse } from "../../../server/errors";
import { usageSummary } from "../../../server/ai/usage";

/** Local usage diagnostics: API calls, cache hits, tokens and SAM frames. */
export async function GET() {
  try {
    return Response.json(await usageSummary(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
