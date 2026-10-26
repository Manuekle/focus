import { scheduleSweep, TICK_LOOKBACK_MINUTES, TICK_MINUTES, type Sweep } from "@/lib/cron-tick";
import { reconcileHostedChannels } from "@/lib/hosted-channels";
import { fireScheduledAutomations } from "@/lib/scheduled-automations";
import adsWeekly from "@/agent/schedules/ads-weekly";
import appointmentJobs from "@/agent/schedules/appointment-jobs";
import automationResume from "@/agent/schedules/automation-resume";
import followups from "@/agent/schedules/followups";
import instagramToken from "@/agent/schedules/instagram-token";
import metaLeads from "@/agent/schedules/meta-leads";
import payments from "@/agent/schedules/payments";
import prospect from "@/agent/schedules/prospect";
import reminders from "@/agent/schedules/reminders";
import team from "@/agent/schedules/team";

// The frequent schedules one tick runs, shared by the two clocks that can
// call it: QStash on www.oruka.si and self-serve Vercel installs
// (/api/cron/tick), and the oruka-fleet sweep on hosted tenants
// (/api/fleet/tick). Both run every TICK_MINUTES, so a cron automation set
// between two ticks fires on the next one.
//
// `instagram-token` is daily work, but it decides for itself (a token under
// 30 days old is left alone), so the tick runs it too: renewing the token no
// longer depends on the Vercel cron alone, which Hobby runs once a day at best.
// `ads-weekly` is weekly work that decides for itself too: it sends the
// Monday report once, on the first tick past Monday 13:00 UTC.
// `channel-routing` is hosted only: it registers Meta routing a connect did
// not finish, and retries a refused one (lib/hosted-channels.ts).

export { TICK_MINUTES };

export const TICK_SWEEPS: readonly Sweep[] = [
  scheduleSweep("reminders", reminders),
  scheduleSweep("appointment-jobs", appointmentJobs),
  scheduleSweep("automation-resume", automationResume),
  // A cron automation set for a minute between two ticks must still fire, so
  // this one looks back instead of matching `now` alone: over two ticks, so a
  // late or missed tick loses nothing (each minute fires once, by its key).
  { name: "automations", run: (now) => fireScheduledAutomations(now, TICK_LOOKBACK_MINUTES) },
  scheduleSweep("followups", followups),
  scheduleSweep("payments", payments),
  scheduleSweep("team", team),
  scheduleSweep("meta-leads", metaLeads),
  scheduleSweep("prospect", prospect),
  scheduleSweep("instagram-token", instagramToken),
  scheduleSweep("ads-weekly", adsWeekly),
  { name: "channel-routing", run: () => reconcileHostedChannels() },
];
