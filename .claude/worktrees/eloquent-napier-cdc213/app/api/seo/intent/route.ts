import { NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { featureGate } from "@/lib/features-gate";
import { MAX_SEARCHES, judgeSearches } from "@/lib/seo-intent";

export const dynamic = "force-dynamic";
// 500 searches is 20 Jev requests, three at a time: seconds, normally.
export const maxDuration = 120;

// POST /api/seo/intent { queries: string[], cachedOnly?: boolean }
//   — which searches come from buyers. `cachedOnly` answers from what was
//     already judged and spends nothing; without it the rest are judged.

/** Longer than any real search; a "query" past this is not one. */
const MAX_QUERY = 300;

export const POST = withApiErrors(async function POST(request: Request) {
  const off = await featureGate("seo.buyers");
  if (off) return off;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError("invalid_json");
  if (!Array.isArray(body.queries)) return missingField("queries");

  const queries = body.queries
    .filter((query): query is string => typeof query === "string" && query.trim().length > 0)
    .map((query) => query.slice(0, MAX_QUERY));
  if (queries.length > MAX_SEARCHES) return apiError("too_large", { field: "queries" });

  return NextResponse.json(await judgeSearches(queries, { cachedOnly: body.cachedOnly === true }));
});
