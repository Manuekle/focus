import {
  AlertCircleIcon,
  Calendar03Icon,
  HashIcon,
  MessageCircleIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@/components/icons/icon";
import {
  readDuration,
  readKeywords,
  readLocalSchedule,
  type AutomationProposal,
  type AutomationProposalStep,
  type AutomationProposalTrigger,
} from "@/lib/automation-proposal";
import { weekdayNames } from "@/lib/cron-builder";
import { stepPreview } from "@/lib/workflow-step-meta";

// The words a proposed automation is read in, shared by its two views in the
// chat: the text plan and the diagram (./automation-diagram.tsx). One copy, so
// the trigger the diagram's first node names is the one the plan describes.

type Translate = (key: string, params?: Record<string, string>) => string;

export const TRIGGER_ICONS: Record<AutomationProposalTrigger, IconSvgElement> = {
  keyword: HashIcon,
  schedule: Calendar03Icon,
  new_chat: MessageCircleIcon,
  no_reply: AlertCircleIcon,
  webhook: WebhookIcon,
};

/** The Automations page's own names for the triggers. */
export const TRIGGER_LABELS: Record<AutomationProposalTrigger, string> = {
  keyword: "automations.triggerKeyword",
  schedule: "automations.triggerSchedule",
  new_chat: "automations.triggerNewChat",
  no_reply: "automations.triggerNoReply",
  webhook: "automations.triggerWebhook",
};

/**
 * The schedule in words, on the business's clock, or null for a cron that has
 * no plain sentence (it is shown as written). The model writes the cron in
 * local time and the build converts it to UTC (lib/automation-schedule.ts).
 */
export function scheduleSentence(cron: string, locale: string, t: Translate): string | null {
  const schedule = readLocalSchedule(cron);
  if (schedule.kind === "custom") return null;
  if (schedule.kind === "interval") {
    return t("proposal.automation.schedule.interval", {
      every: durationText({ amount: schedule.minutes, unit: "minute" }, locale),
    });
  }
  const time = clockTime(schedule.hour, schedule.minute, locale);
  if (schedule.kind === "daily" || (schedule.kind === "weekly" && schedule.days.length === 7)) {
    return t("proposal.automation.schedule.daily", { time });
  }
  if (schedule.kind === "weekly") {
    return t("proposal.automation.schedule.weekly", { days: weekdaysText(schedule.days, locale, t), time });
  }
  return t(
    schedule.days.length === 1 ? "proposal.automation.schedule.monthly" : "proposal.automation.schedule.monthlyMany",
    { days: listText(schedule.days.map(String), locale), time },
  );
}

/** What fires it, in one line: the diagram's first node. */
export function triggerSummary(proposal: AutomationProposal, locale: string, t: Translate): string {
  switch (proposal.trigger) {
    case "keyword": {
      const words = readKeywords(proposal.triggerValue);
      return words.length > 0 ? words.map((word) => `«${word}»`).join(" · ") : t("proposal.automation.trigger.keyword");
    }
    case "schedule":
      return scheduleSentence(proposal.triggerValue, locale, t) ?? (proposal.triggerValue.trim() || "—");
    case "no_reply": {
      const duration = readDuration(proposal.triggerValue);
      const wait = duration ? durationText(duration, locale) : proposal.triggerValue;
      return wait ? t("proposal.automation.trigger.no_reply", { duration: wait }) : t("automations.triggerNoReplyDesc");
    }
    case "new_chat":
      return t("proposal.automation.trigger.new_chat");
    case "webhook":
      return t("proposal.automation.trigger.webhook");
  }
}

/** What a step says or does, in one line the owner can check. */
export function stepText(step: AutomationProposalStep, locale: string): string | null {
  if (step.type === "wait") {
    const duration = readDuration(step.config.duration ?? "");
    if (duration) return durationText(duration, locale);
  }
  return stepPreview({ type: step.type, config: step.config });
}

export function durationText(duration: { readonly amount: number; readonly unit: "minute" | "hour" | "day" }, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "unit", unit: duration.unit, unitDisplay: "long" }).format(duration.amount);
  } catch {
    return `${duration.amount} ${duration.unit}`;
  }
}

function clockTime(hour: number, minute: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 7, hour, minute)),
  );
}

/** Weekdays as a person lists them: a run of three or more is a range. */
function weekdaysText(days: readonly number[], locale: string, t: Translate): string {
  const names = weekdayNames(locale, "long");
  // Monday first: "lunes a viernes" reads right, "domingo a jueves" rarely is.
  const order = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const contiguous = order.every((day, index) => index === 0 || (order[index - 1] + 1) % 7 === day);
  if (order.length >= 3 && contiguous) {
    return capitalize(t("proposal.automation.schedule.range", { from: names[order[0]], to: names[order[order.length - 1]] }));
  }
  return capitalize(listText(order.map((day) => names[day]), locale));
}

function listText(items: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
