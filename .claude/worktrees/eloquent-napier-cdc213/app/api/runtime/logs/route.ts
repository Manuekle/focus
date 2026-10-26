import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { requireOwner } from "@/lib/owner-gate";
import { clearLogs, listLogs, listSessions } from "@/lib/runtime-store";

// The log tail the runtime page polls, newest first. Written by
// agent/hooks/runtime-log.ts as turns run.
//
// `?since=` is the page's incremental cursor (inclusive; the caller drops the
// cursor's own line by id), so a quiet poll answers with an empty array.
// `?sessionId=` narrows the tail to one run.
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const [logs, sessions] = await Promise.all([
    listLogs({
      since: params.get("since") ?? undefined,
      sessionId: params.get("sessionId") ?? undefined,
    }),
    listSessions(),
  ]);
  return NextResponse.json({ logs, sessions }, { headers: { "cache-control": "no-store" } });
});

// Clearing throws away what happened, so only the owner can do it.
export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const denied = await requireOwner(request);
  if (denied) return denied;
  await clearLogs();
  return NextResponse.json({ ok: true });
});
