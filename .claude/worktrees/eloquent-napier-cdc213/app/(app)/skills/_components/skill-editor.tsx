"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AlertCircleIcon, GlobalEducationIcon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Checkbox } from "@/components/motion/checkbox";
import { TEMPLATE_PLACEHOLDER } from "@/lib/skill-templates";
import type { Agent, AgentSkill } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";

// Write or edit one skill.
//
// The two fields that look the same and are not:
//
//   **description** is the routing hint. Eve puts it in front of the model on
//   every single turn and the model decides from it alone whether to load the
//   body. It is the only field whose wording changes *whether* the skill runs,
//   so it gets its own explanation and a character counter rather than sitting
//   in a row of look-alike inputs.
//
//   **markdown** is the procedure. It costs nothing until it is loaded, so it
//   can be as long as the job needs.
//
// The unfilled-blank counter exists because these mostly start from a template
// and `[completar]` is easy to miss in the middle of a long body. A skill that
// still says "el plazo de devolución es [completar]" will be read out to a
// customer word for word.

export type SkillDraft = {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  readonly agentIds: readonly string[];
  readonly enabled: boolean;
};

export function draftFromSkill(skill: AgentSkill | null): SkillDraft {
  return {
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    markdown: skill?.markdown ?? "",
    agentIds: skill?.agentIds ?? [],
    enabled: skill?.enabled ?? false,
  };
}

export function SkillEditor({
  open,
  onOpenChange,
  editing,
  initial,
  agents,
  onSave,
  saving,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly editing: AgentSkill | null;
  /** Seed for a new skill — a template's body, or empty. */
  readonly initial?: SkillDraft;
  readonly agents: readonly Agent[];
  readonly onSave: (draft: SkillDraft) => Promise<boolean>;
  readonly saving: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState<SkillDraft>(() => initial ?? draftFromSkill(editing));

  const patch = (updates: Partial<SkillDraft>) =>
    setDraft((current) => ({ ...current, ...updates }));

  const blanks = useMemo(
    () => draft.markdown.split(TEMPLATE_PLACEHOLDER).length - 1,
    [draft.markdown],
  );

  const toggleAgent = (id: string) =>
    patch({
      agentIds: draft.agentIds.includes(id)
        ? draft.agentIds.filter((entry) => entry !== id)
        : [...draft.agentIds, id],
    });

  const submit = async () => {
    const saved = await onSave(draft);
    if (saved) onOpenChange(false);
  };

  const complete = draft.name.trim() && draft.description.trim() && draft.markdown.trim();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle
            icon={
              <HugeiconsIcon
                icon={editing ? PencilEdit01Icon : GlobalEducationIcon}
                size={18}
                strokeWidth={1.75}
              />
            }
          >
            {editing ? t("skills.editorEditTitle") : t("skills.editorNewTitle")}
          </DrawerTitle>
          <DrawerDescription>
            {t("skills.editorDescription")}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="min-h-0 space-y-4 pr-1">
          <div className="space-y-1.5">
            <label htmlFor="skill-name" className="text-xs font-medium text-foreground">
              {t("skills.fieldName")}
            </label>
            <Input
              id="skill-name"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder={t("skills.fieldNamePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skill-description" className="text-xs font-medium text-foreground">
              {t("skills.fieldWhen")}
            </label>
            <Textarea
              id="skill-description"
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              rows={2}
              placeholder={t("skills.fieldWhenPlaceholder")}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("skills.fieldWhenHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="skill-markdown" className="text-xs font-medium text-foreground">
                {t("skills.fieldBody")}
              </label>
              {blanks > 0 ? (
                <span className="flex items-center gap-1 text-[11px] text-[color:var(--status-pending-fg)]">
                  <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={2} />
                  {t("skills.blanks", { count: blanks })}
                </span>
              ) : null}
            </div>
            <Textarea
              id="skill-markdown"
              value={draft.markdown}
              onChange={(event) => patch({ markdown: event.target.value })}
              rows={16}
              className="font-mono text-xs leading-relaxed"
              placeholder={`## ${t("skills.fieldWhen")}\n\n## ${t("skills.fieldBody")}\n\n1. …`}
            />
          </div>

          {agents.length > 0 ? (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t("skills.fieldAgents")}</span>
              <div className="flex flex-wrap gap-1.5">
                <ToggleChip
                  selected={draft.agentIds.length === 0}
                  onClick={() => patch({ agentIds: [] })}
                >
                  {t("skills.allAgents")}
                </ToggleChip>
                {agents.map((agent) => (
                  <ToggleChip
                    key={agent.id}
                    selected={draft.agentIds.includes(agent.id)}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    {agent.name}
                  </ToggleChip>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("skills.fieldAgentsHint")}
              </p>
            </div>
          ) : null}

          <div className="flex items-start gap-2.5 rounded-xl border border-border p-3">
            <Checkbox
              id="skill-enabled"
              checked={draft.enabled}
              onCheckedChange={(enabled) => patch({ enabled })}
              aria-label={t("skills.fieldEnabled")}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <label htmlFor="skill-enabled" className="block cursor-pointer text-xs font-medium text-foreground">
                {t("skills.fieldEnabled")}
              </label>
              <span
                className={cn(
                  "block text-[11px] leading-relaxed",
                  blanks > 0 && draft.enabled
                    ? "text-[color:var(--status-pending-fg)]"
                    : "text-muted-foreground",
                )}
              >
                {blanks > 0 && draft.enabled
                  ? t("skills.fieldEnabledWarn")
                  : t("skills.fieldEnabledOff")}
              </span>
            </span>
          </div>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !complete}>
            {saving ? t("automations.saving") : t("common.save")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
