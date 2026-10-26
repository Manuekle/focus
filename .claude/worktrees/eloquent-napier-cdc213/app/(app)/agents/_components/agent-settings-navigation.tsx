"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { Tick02Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { SECTION_ICONS, type SectionId } from "./agent-sections";
import type { BlueprintSection } from "./agent-blueprint";
import type { ReadinessCheck } from "@/lib/agent-brief";

const GROUPS: readonly { id: string; sections: readonly SectionId[] }[] = [
  { id: "behavior", sections: ["identity", "brief", "rules", "capabilities"] },
  { id: "connections", sections: ["channels", "voice", "business"] },
  { id: "advanced", sections: ["prompt", "model"] },
];

export function AgentSettingsNavigation({ sections, selected, onSelect }: {
  readonly sections: readonly BlueprintSection[];
  readonly selected: SectionId;
  readonly onSelect: (id: SectionId) => void;
}) {
  const t = useT();
  const byId = new Map(sections.map((section) => [section.id, section]));
  return (
    <>
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 @min-[760px]/agent-editor:hidden">
        <label id="agent-settings-section-label" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t("builder.chooseSection")}
        </label>
        <Select value={selected} onValueChange={(next) => onSelect(next as SectionId)}>
          <SelectTrigger aria-labelledby="agent-settings-section-label" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((group) => (
              <SelectGroup key={group.id}>
                <SelectLabel>{t(`builder.group.${group.id}`)}</SelectLabel>
                {group.sections.map((id) => <SelectItem key={id} value={id}>{t(`builder.section.${id}`)}</SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label={t("builder.sectionTab")} className="hidden min-h-0 w-72 shrink-0 space-y-6 overflow-y-auto overscroll-contain border-r border-border bg-muted/20 p-3 @min-[760px]/agent-editor:block">
        {GROUPS.map((group) => (
          <div key={group.id}>
            <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{t(`builder.group.${group.id}`)}</p>
            <div className="space-y-1">
              {group.sections.map((id) => {
                const item = byId.get(id);
                if (!item) return null;
                return (
                  <button key={id} type="button" onClick={() => onSelect(id)} aria-current={selected === id ? "page" : undefined}
                    className={cn("flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      selected === id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
                    <HugeiconsIcon icon={SECTION_ICONS[id]} size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t(`builder.section.${id}`)}</span>
                      <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.warning || item.summary || t(`builder.sectionEmpty.${id}`)}</span>
                    </span>
                    {item.warning ? <HugeiconsIcon icon={AlertCircleIcon} size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                      : item.done ? <HugeiconsIcon icon={Tick02Icon} size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}

/**
 * What still blocks activation, sitting beside the button it blocks. Once
 * everything required is done it shrinks to a quiet confirmation.
 */
export function AgentReadiness({ checks, onSelect, className }: {
  readonly checks: readonly ReadinessCheck[];
  readonly onSelect: (id: SectionId) => void;
  readonly className?: string;
}) {
  const t = useT();
  const required = checks.filter((check) => !check.optional);
  const missing = required.filter((check) => !check.done);
  const done = required.length - missing.length;
  if (missing.length === 0) {
    return (
      <span className={cn("hidden items-center gap-1.5 text-xs text-muted-foreground @min-[720px]/agent-editor:inline-flex", className)}>
        <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={1.75} aria-hidden="true" />
        {t("builder.setupComplete")}
      </span>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      <span aria-hidden="true" className="flex items-center gap-0.5">
        {required.map((check, index) => (
          <span key={check.id} className={cn("h-1 w-3 rounded-full", index < done ? "bg-foreground/70" : "bg-border")} />
        ))}
      </span>
      <span className="font-medium tabular-nums text-foreground">{t("builder.setupProgress", { done, total: required.length })}</span>
      <span className="text-muted-foreground">{t("builder.stillMissing")}</span>
      {missing.map((check) => (
        <button key={check.id} type="button" onClick={() => onSelect(check.id as SectionId)}
          className="min-h-6 rounded px-0.5 text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t(`builder.check.${check.id}`)}
        </button>
      ))}
    </div>
  );
}
