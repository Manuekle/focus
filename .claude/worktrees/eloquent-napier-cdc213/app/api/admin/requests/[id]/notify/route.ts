import { type NextRequest, NextResponse } from "next/server";
import { verifiedOperator } from "@/lib/admin";
import { apiError, withApiErrors } from "@/lib/api-error";
import { claimNoticeRetry, recordNoticeRetry } from "@/lib/access-requests";
import { sendRequestNotice } from "@/lib/access-request-notice";

// POST /api/admin/requests/<id>/notify — resends the team's email about a
// request whose first notice failed (or was abandoned mid-send). Controlled:
// only such a request, one resend at a time (claimNoticeRetry), and the
// outcome lands in the request's history. It never writes to the prospect.

export const POST = withApiErrors(async function POST(
  request: NextRequest, { params }: { params: Promise<{ id: string }> },
) {
  const operator = await verifiedOperator();
  if (!operator) return apiError("not_found");
  if (request.headers.get("origin") !== request.nextUrl.origin) return apiError("forbidden");
  const { id } = await params;
  if (!/^req_[\w-]{20}$/.test(id)) return apiError("not_found");
  const claimed = await claimNoticeRetry(id);
  if (!claimed) return apiError("conflict", { message: "El aviso ya se envió o se está reenviando." });
  let sent = false;
  try {
    sent = await sendRequestNotice(claimed);
  } catch {
    sent = false;
  }
  const after = await recordNoticeRetry(id, sent, operator);
  if (!after) return apiError("not_found");
  return NextResponse.json({ request: after, sent }, { headers: { "cache-control": "private, no-store" } });
});
