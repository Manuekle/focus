import type { IconSvgElement } from "@/components/icons/icon";
import {
  AlertCircleIcon,
  Calendar03Icon,
  HashIcon,
  MessageCircleIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { automationToN8n, n8nFileName } from "@/lib/n8n-workflow";
import { STEP_LABEL_KEYS } from "@/lib/workflow-step-meta";
import type { useT } from "@/lib/i18n/provider";
import type { Automation, AutomationTrigger, WorkflowStep } from "@/lib/types";

// Shared by the automations list, the template board, the n8n import dialog
// and the flow page, so the five triggers are named and drawn one way.

export const TRIGGER_ICONS: Record<AutomationTrigger, IconSvgElement> = {
  keyword: HashIcon,
  schedule: Calendar03Icon,
  new_chat: MessageCircleIcon,
  no_reply: AlertCircleIcon,
  webhook: WebhookIcon,
  intent: HashIcon,
};

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  keyword: "automations.triggerKeyword",
  schedule: "automations.triggerSchedule",
  new_chat: "automations.triggerNewChat",
  no_reply: "automations.triggerNoReply",
  webhook: "automations.triggerWebhook",
  intent: "automations.triggerIntent",
};

/**
 * Download an automation as an n8n workflow file.
 *
 * `steps` overrides the stored ones: the flow page passes what is on the
 * canvas, which can be a save ahead of what the list last fetched.
 */
export function downloadN8nWorkflow(
  automation: Automation,
  t: ReturnType<typeof useT>,
  steps: readonly WorkflowStep[] = automation.steps ?? [],
): void {
  const workflow = automationToN8n(
    { ...automation, steps: [...steps] },
    {
      labels: {
        step: (type) => t(STEP_LABEL_KEYS[type]),
        trigger: t(TRIGGER_LABELS[automation.trigger]),
        note: t("automations.exportNote"),
      },
    },
  );
  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = n8nFileName(automation.name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
