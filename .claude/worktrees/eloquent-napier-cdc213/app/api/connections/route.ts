import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getConnectionSummaries } from "@/lib/connection-store";
import { hiddenConnections } from "@/lib/features-server";

// GET /api/connections — what the Connections page draws.
//
// Status only: whether an account is connected, whose it is, and when it was
// linked. No token, no scope string, no client secret ever crosses this line.

export const GET = withApiErrors(async function GET() {
  const [{ oauth, manual }, hidden] = await Promise.all([getConnectionSummaries(), hiddenConnections()]);
  // A key for a feature the operator switched off (lib/features.ts) is a card
  // with nothing behind it: not offered.
  return NextResponse.json({ connections: oauth, manual: manual.filter((entry) => !hidden.has(entry.id)) });
});
