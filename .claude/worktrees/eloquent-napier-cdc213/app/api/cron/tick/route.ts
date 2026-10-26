import { type NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { apiError, withApiErrors } from "@/lib/api-error";
import { runSweeps, tickIdAt } from "@/lib/cron-tick";
import { runTickOnce } from "@/lib/tick-lease";
import { TICK_SWEEPS } from "./sweeps";

// POST /api/cron/tick — the frequent schedules, on an outside clock.
//
// Vercel Hobby runs cron jobs at most once a day (lib/cron-tick.ts), so a
// QStash schedule calls this every TICK_MINUTES instead. Public in
// middleware.ts: QStash sends no session, and its signed JWT — tried against
// the current and next signing keys, and bound to this exact URL — is what
// stands in for auth. An install with no QStash keys answers not_configured
// and runs nothing; self-hosted installs keep Eve's own per-minute schedules.
//
// Hosted tenants have no QStash keys: the oruka-fleet sweep runs the same
// sweeps through /api/fleet/tick instead. The list lives in ./sweeps.ts.

// The run takes a few seconds normally; the ceiling covers a backlog.
export const maxDuration = 300;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!currentSigningKey || !nextSigningKey) {
    return apiError("not_configured", {
      message: "QStash signing keys are not set, so the tick is off on this installation.",
    });
  }

  const body = await request.text();
  const signature = request.headers.get("upstash-signature");
  if (!signature) return apiError("unauthorized", { message: "Missing QStash signature." });
  try {
    await new Receiver({ currentSigningKey, nextSigningKey }).verify({
      signature,
      body,
      url: `${request.nextUrl.origin}${request.nextUrl.pathname}`,
      clockTolerance: 5,
    });
  } catch {
    return apiError("unauthorized", { message: "Invalid QStash signature." });
  }

  // Always 200 once the caller is verified: a failed sweep is logged and
  // reported, and the next tick sweeps again. A non-2xx would make QStash
  // retry the whole tick, re-running the sweeps that did succeed. A
  // redelivery of the same 15-minute tick is skipped (lib/tick-lease.ts).
  const now = new Date();
  const tick = await runTickOnce(tickIdAt(now), () => runSweeps(TICK_SWEEPS, now));
  if (!tick.ran) return NextResponse.json({ ok: true, skipped: tick.reason });
  return NextResponse.json({ ok: tick.value.every((result) => result.ok), results: tick.value });
});
