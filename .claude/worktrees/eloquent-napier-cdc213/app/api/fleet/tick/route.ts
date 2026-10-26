import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { announcementStats } from "@/lib/announcements";
import { parseTickId, runSweeps, tickIdAt } from "@/lib/cron-tick";
import { isFleetRequest } from "@/lib/hosted";
import { channelReport } from "@/lib/hosted-channels";
import { getInstallationId } from "@/lib/license/installation";
import { getUsageSnapshot } from "@/lib/usage-report";
import { runTickOnce } from "@/lib/tick-lease";
import { TICK_SWEEPS } from "../../cron/tick/sweeps";

// POST /api/fleet/tick — the frequent schedules on a hosted tenant.
//
// Vercel Hobby runs a tenant's cron jobs at most once a day, and tenants have
// no QStash keys, so /api/cron/tick answers not_configured there: reminders,
// follow-ups and scheduled automations ran up to a day late. The oruka-fleet
// sweep, which already runs every 15 minutes, now calls this on every live
// tenant instead. One schedule for the whole fleet, however many tenants.
//
// Public in middleware.ts (the fleet has no session); the Bearer fleet token
// is the only way in, and every call on a self-hosted install is a 404.
// Contract: docs/hosted-fleet-contract.md.
//
// Body `{tickId}`: the fleet's 15-minute bucket. A tick id runs once, never
// after a later one, and never alongside another tick (lib/tick-lease.ts), so
// an overlapping, redelivered or late sweep cannot run the sweeps twice. The
// answer carries the channel states (names and short reasons, never a
// credential), a usage snapshot (model credits and cost over 30 days,
// numbers only) and, per announcement held, how many accounts saw, followed
// and dismissed it (counts, never who), for the fleet's registry and the
// operator's admin panel.
// Body `{probe: true}`: the release gate's check that the route is there;
// nothing runs.

// The run takes a few seconds normally; the ceiling covers a backlog.
export const maxDuration = 300;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  const body = (await request.json().catch(() => null)) as { tickId?: unknown; probe?: unknown } | null;

  // The fleet's release gate: the route is deployed and the token opens it.
  // Answered before anything runs: no lease, no sweep, nobody messaged.
  if (body?.probe === true) return NextResponse.json({ ok: true, probe: true });

  // One producer per schedule. A tenant that was given its own QStash tick
  // keeps it, and this one stands down rather than run every sweep twice.
  if (process.env.QSTASH_CURRENT_SIGNING_KEY?.trim()) {
    return NextResponse.json({ ok: true, skipped: "qstash" });
  }

  const now = new Date();
  const tickId = parseTickId(body?.tickId, now) ?? tickIdAt(now);

  // 200 once the fleet is verified, like /api/cron/tick: a failed sweep is
  // logged and reported, and the next tick sweeps again.
  const tick = await runTickOnce(tickId, () => runSweeps(TICK_SWEEPS, now));
  const [channels, usage, announcements] = await Promise.all([
    channelReport().catch(() => null),
    getInstallationId()
      .then((organizationId) => getUsageSnapshot(organizationId, now))
      .catch(() => null),
    announcementStats().catch(() => null),
  ]);
  const reports = {
    ...(channels ? { channels } : {}),
    ...(usage ? { usage } : {}),
    ...(announcements && Object.keys(announcements).length ? { announcements } : {}),
  };
  if (!tick.ran) return NextResponse.json({ ok: true, skipped: tick.reason, tickId, ...reports });
  return NextResponse.json({
    ok: tick.value.every((result) => result.ok),
    tickId,
    results: tick.value,
    ...reports,
  });
});
