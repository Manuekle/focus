import { NextResponse, type NextRequest } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { reportSpecSchema } from "@/lib/artifacts";
import { renderReport, reportFilename } from "@/lib/report-pdf";

// POST /api/reports/pdf — { ...ReportSpec } → application/pdf
//
// The download behind the report card the agent produces in the chat
// (`agent/tools/report.ts`). The spec is posted back from the browser rather
// than stored: the card already holds it, it is the operator's own content,
// and a store would mean an id, an expiry and a cleanup job for a document
// most people download once.
//
// Nothing here reads the account. It is a pure transform — spec in, bytes out —
// which is why it can be this permissive about what it accepts and still be
// safe. Session auth is the middleware's job (see middleware.ts: every /api
// route not on the public allowlist requires one). The drawing itself lives in
// lib/report-pdf.ts, so it can be exercised without an HTTP request.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const parsed = reportSpecSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("invalid_body", {
      message: `That is not a report: ${parsed.error.issues[0]?.message ?? "unknown field"}.`,
    });
  }

  const bytes = await renderReport(parsed.data);
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${reportFilename(parsed.data.title)}.pdf"`,
      "content-type": "application/pdf",
    },
  });
});
