"use client";

import { type FormEvent, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AiPaintbrushIcon } from "@hugeicons/core-free-icons";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Orb } from "@/components/ui/orb";
import { AGENT_TEMPLATES } from "@/lib/agent-templates";
import { useT } from "@/lib/i18n/provider";
import { ToggleChip } from "@/components/ui/toggle-chip";

// Creating an agent asks for two things: a name, and one sentence about what
// it is for.
//
// Everything else — the role, the tone, the rules, what it may reach for — is
// the workspace's job, and asking for it here would just be the old form with
// a different frame around it. The sentence is not thrown away either: it is
// parked in sessionStorage and becomes the first message of the interview, so
// the builder opens already knowing why it exists.
//
// A template, when one is picked, only pre-fills the name and the capability
// set. The agent still lands as a draft in the workspace rather than going
// straight to work, because a template is a starting point for *this*
// business, not a finished hire.

export type NewAgentInput = {
  readonly name: string;
  readonly goal: string;
  readonly tools: readonly string[];
};

export function AgentCreateDialog({
  onCreate,
  creating,
}: {
  readonly onCreate: (input: NewAgentInput) => void;
  readonly creating: boolean;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);

  const pickTemplate = (id: string) => {
    if (templateId === id) {
      setTemplateId(null);
      return;
    }
    setTemplateId(id);
    // Only fills what is still empty: a name someone typed is theirs, and a
    // template should never overwrite it.
    if (!name.trim()) setName(t(`agentTemplates.${id}.name`));
    if (!goal.trim()) setGoal(t(`agentTemplates.${id}.description`));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    const template = AGENT_TEMPLATES.find((entry) => entry.id === templateId);
    onCreate({ name: trimmed, goal: goal.trim(), tools: template ? [...template.tools] : [] });
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle icon={<HugeiconsIcon icon={AiPaintbrushIcon} size={18} strokeWidth={1.75} />}>
          {t("agents.createAgent")}
        </DialogTitle>
        <DialogDescription>{t("builder.createDescription")}</DialogDescription>
      </DialogHeader>

      <form onSubmit={submit}>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("agents.name")}</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("agents.namePlaceholder")}
            autoComplete="off"
            data-1p-ignore="true"
            required
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("builder.createGoal")}</span>
          <span className="block text-[11px] leading-relaxed text-muted-foreground">
            {t("builder.createGoalHint")}
          </span>
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t("builder.createGoalPlaceholder")}
            rows={3}
            className="resize-none text-sm"
          />
        </label>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("builder.createTemplate")}</p>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_TEMPLATES.map((template) => (
              <ToggleChip
                key={template.id}
                selected={templateId === template.id}
                onClick={() => pickTemplate(template.id)}
              >
                <HugeiconsIcon icon={template.icon} size={13} strokeWidth={1.75} />
                {t(`agentTemplates.${template.id}.name`)}
              </ToggleChip>
            ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={creating}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={!name.trim() || creating}>
            {creating ? (
              <span className="flex items-center gap-2">
                <Orb state="working" />
                {t("builder.creating")}
              </span>
            ) : (
              t("builder.createAndOpen")
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
