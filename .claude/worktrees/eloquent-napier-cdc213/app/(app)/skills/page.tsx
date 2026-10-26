"use client";

import "../product.css";
import { SkillsSkeleton } from "./page-skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  Delete01Icon,
  PencilEdit01Icon,
  GlobalEducationIcon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Card } from "../../_components/dashboard-card";
import { KpiCard } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useT, useI18n } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage, type UiError } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import { countPlaceholders, templateContent } from "@/lib/skill-templates";
import type { SkillTemplate } from "@/lib/skill-templates";
import type { Agent, AgentSkill } from "@/lib/types";
import { SkillEditor, draftFromSkill, type SkillDraft } from "./_components/skill-editor";
import { TemplatePicker } from "./_components/template-picker";

// The business's own procedures.
//
// The mental model the page has to teach in one screen: a *document* is
// something the agent looks things up in, a *skill* is something the agent
// follows. That is why the empty state points at Conocimiento and why the
// per-row warning is about unfilled blanks rather than about length — a skill
// with `[completar]` in it is a skill that will say `[completar]` to a
// customer.

const SOURCE_LABEL: Record<AgentSkill["source"], string> = {
  manual: "skills.sourceManual",
  template: "skills.sourceTemplate",
  knowledge: "skills.sourceKnowledge",
};

export default function SkillsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AgentSkill | null>(null);
  const [seed, setSeed] = useState<SkillDraft | undefined>(undefined);

  const load = useCallback(async () => {
    const [skillsResult, agentsResult] = await Promise.all([
      fetchJson<{ skills?: AgentSkill[] }>("/api/skills", t),
      fetchJson<{ agents?: Agent[] }>("/api/agents", t),
    ]);
    if (skillsResult.ok) {
      setSkills(skillsResult.data.skills ?? []);
      setError(null);
    } else {
      setError(skillsResult.error);
    }
    if (agentsResult.ok) setAgents(agentsResult.data.agents ?? []);
  }, [t]);

  useEffect(() => {
    void load().finally(() => setIsLoading(false));
  }, [load]);

  const openNew = useCallback((draft?: SkillDraft) => {
    setEditing(null);
    setSeed(draft ?? draftFromSkill(null));
    setEditorOpen(true);
  }, []);

  const openTemplate = useCallback(
    (template: SkillTemplate) => {
      const content = templateContent(template, locale);
      openNew({
        name: content.name,
        description: content.description,
        markdown: content.markdown,
        agentIds: [],
        // A template arrives with blanks in it. Off until somebody fills them.
        enabled: false,
      });
    },
    [locale, openNew],
  );

  const save = useCallback(
    async (draft: SkillDraft): Promise<boolean> => {
      setSaving(true);
      const result = await fetchJson<{ skill?: AgentSkill }>("/api/skills", t, {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...draft } : draft),
      });
      setSaving(false);
      if (!result.ok) {
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
        return false;
      }
      await load();
      toast({ title: editing ? t("skills.updated") : t("skills.created"), status: "success" });
      return true;
    },
    [editing, load, t, toast],
  );

  const toggle = useCallback(
    async (skill: AgentSkill, enabled: boolean) => {
      // Optimistic: the switch has to move under the finger. A failure puts it
      // back and says why.
      setSkills((current) =>
        current.map((entry) => (entry.id === skill.id ? { ...entry, enabled } : entry)),
      );
      const result = await fetchJson("/api/skills", t, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: skill.id, enabled }),
      });
      if (!result.ok) {
        setSkills((current) =>
          current.map((entry) =>
            entry.id === skill.id ? { ...entry, enabled: skill.enabled } : entry,
          ),
        );
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
      }
    },
    [t, toast],
  );

  const remove = useCallback(
    async (skill: AgentSkill) => {
      const ok = await confirm({
        title: t("skills.deleteConfirm", { name: skill.name }),
        description: t("skills.deleteConfirmBody"),
        confirmLabel: t("common.delete"),
      });
      if (!ok) return;
      const result = await fetchJson(`/api/skills?id=${encodeURIComponent(skill.id)}`, t, {
        method: "DELETE",
      });
      if (result.ok) {
        await load();
        toast({ title: t("common.deleted") });
      } else {
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
      }
    },
    [confirm, load, t, toast],
  );

  const agentNames = useCallback(
    (ids: readonly string[]) =>
      ids.length === 0
        ? t("skills.allAgents")
        : ids
            .map((id) => agents.find((agent) => agent.id === id)?.name ?? "?")
            .join(", "),
    [agents, t],
  );

  const activeCount = useMemo(() => skills.filter((skill) => skill.enabled).length, [skills]);
  const incompleteCount = skills.filter((skill) => countPlaceholders(skill.markdown) > 0).length;
  const emptyHint = t("skills.emptyHint");
  const knowledgeTitle = t("knowledge.title");
  const [emptyHintBeforeKnowledge, emptyHintAfterKnowledge] = emptyHint.split(knowledgeTitle);

  if (isLoading) {
    return (
      <PageContainer maxWidth="max-w-6xl" title={t("skills.title")} description={t("skills.subtitle")}>
        <SkillsSkeleton />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      maxWidth="max-w-6xl"
      title={t("skills.title")}
      description={t("skills.subtitle")}
      actions={
        <Button size="sm" onClick={() => openNew()}>
          <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
          {t("skills.new")}
        </Button>
      }
    >
      <div className="content-enter">
        {error ? <ErrorBanner error={error} onRetry={() => void load()} /> : null}

        {skills.length > 0 ? (
        <CardCarousel stats label={t("carousel.stats")}>
          <div className="mb-6 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
            <div className="min-w-[220px] flex-1">
              <KpiCard
                icon={GlobalEducationIcon}
                label={t("skills.kpiTotal")}
                value={skills.length}
                sub={t(skills.length > 0 ? "skills.kpiTotalSub" : "skills.kpiTotalSubNone")}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <KpiCard
                icon={CheckmarkCircle02Icon}
                label={t("skills.kpiActive")}
                value={activeCount}
                sub={t(activeCount > 0 ? "skills.kpiActiveSub" : "skills.kpiActiveSubNone")}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <KpiCard
                icon={AlertCircleIcon}
                label={t("skills.kpiBlanks")}
                value={incompleteCount}
                sub={t(incompleteCount > 0 ? "skills.kpiBlanksSub" : "skills.kpiBlanksSubNone")}
              />
            </div>
          </div>
        </CardCarousel>
        ) : null}

        {skills.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                <HugeiconsIcon icon={GlobalEducationIcon} size={20} strokeWidth={1.75} />
              </div>
              <p className="text-sm font-medium text-foreground">{t("skills.empty")}</p>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                {emptyHintBeforeKnowledge}
                <Link href="/knowledge" className="underline underline-offset-2 hover:text-foreground">
                  {knowledgeTitle}
                </Link>
                {emptyHintAfterKnowledge}
              </p>
            </div>
          </Card>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("skills.activeOf", { active: activeCount, total: skills.length })}
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {skills.map((skill) => {
                const blanks = countPlaceholders(skill.markdown);
                return (
                  <Card key={skill.id} className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
                    <div className="flex flex-col">
                      <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card p-5 shadow-xs">
                        <div className="flex min-w-0 gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                            <HugeiconsIcon icon={GlobalEducationIcon} size={16} strokeWidth={1.75} />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="text-sm font-medium text-foreground">{skill.name}</p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {skill.description}
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* Metadata + actions — outside the inner border */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{t(SOURCE_LABEL[skill.source])}</span>
                          <span>·</span>
                          <span>{agentNames(skill.agentIds)}</span>
                          {blanks > 0 ? (
                            <>
                              <span>·</span>
                              <span className="flex items-center gap-1 text-[color:var(--status-pending-fg)]">
                                <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={2} />
                                {t("skills.blanks", { count: blanks })}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                          <Switch
                            checked={skill.enabled}
                            onCheckedChange={(checked) => void toggle(skill, checked)}
                            label={skill.enabled ? t("skills.disable") : t("skills.enable")}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("skills.editorEditTitle")}
                            onClick={() => {
                              setEditing(skill);
                              setSeed(undefined);
                              setEditorOpen(true);
                            }}
                          >
                            <HugeiconsIcon icon={PencilEdit01Icon} size={15} strokeWidth={1.75} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("skills.deleteConfirm", { name: skill.name })}
                            onClick={() => void remove(skill)}
                          >
                            <HugeiconsIcon icon={Delete01Icon} size={15} strokeWidth={1.75} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
        <TemplatePicker onPick={openTemplate} />
      </div>

      {/* Keyed so the editor never opens holding the previous skill's body. */}
      <SkillEditor
        key={editing?.id ?? (seed ? `seed-${seed.name}` : "new")}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        initial={seed}
        agents={agents}
        onSave={save}
        saving={saving}
      />
      {confirmDialog}
    </PageContainer>
  );
}
