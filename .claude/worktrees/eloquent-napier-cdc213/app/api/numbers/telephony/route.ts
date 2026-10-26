import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/owner-gate";
import { apiError, withApiErrors } from "@/lib/api-error";
import { connectVoiceNumber } from "@/lib/connect-voice-number";
import { rateLimit } from "@/lib/rate-limit";
import { purchaseNumber, searchNumberQuotes, telephonyCompliance, telephonyInventory, TelephonyError, verifyCallerNumber } from "@/lib/twilio-telephony";

function failure(error: unknown) {
  return error instanceof TelephonyError
    ? apiError(error.code, { detail: error.providerCode ? `Twilio ${error.providerCode}` : undefined })
    : apiError("upstream_failed");
}
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), country: z.string().regex(/^[A-Z]{2}$/), kind: z.enum(["Local", "Mobile", "TollFree"]), contains: z.string().regex(/^[\d*]{0,10}$/).default("") }),
  z.object({ action: z.literal("purchase"), quoteId: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("connect"), phone: z.string().max(25), agentId: z.string().min(1).max(100) }),
  z.object({ action: z.literal("verify"), phone: z.string().max(25) }),
]);
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const limit = await rateLimit("telephony-read", request, { max: 60, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited");
  try {
    const section = request.nextUrl.searchParams.get("section");
    return NextResponse.json(section === "compliance" || section === "endUsers"
      ? { rows: await telephonyCompliance(section) }
      : await telephonyInventory());
  } catch (error) { return failure(error); }
});
export const POST = withApiErrors(async function POST(request: NextRequest) {
  const denied = await requireOwner(request);
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("invalid_json"); }
  const parsed = input.safeParse(body);
  if (!parsed.success) return apiError("invalid_body");
  const x = parsed.data;
  const limit = await rateLimit(`telephony-${x.action}`, request, { max: x.action === "verify" ? 3 : 10, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited");
  try {
    if (x.action === "search") return NextResponse.json({ quotes: await searchNumberQuotes(x.country, x.kind, x.contains) });
    if (x.action === "connect") return NextResponse.json(await connectVoiceNumber(x.phone, x.agentId));
    if (x.action === "verify") return NextResponse.json(await verifyCallerNumber(x.phone));
    return NextResponse.json({ number: await purchaseNumber(x.quoteId) });
  } catch (error) { return failure(error); }
});
