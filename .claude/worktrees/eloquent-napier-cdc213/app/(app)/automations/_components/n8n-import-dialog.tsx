"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AlertCircleIcon, CheckmarkCircle02Icon, FileImportIcon } from "@hugeicons/core-free-icons";
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
import { Spinner } from "@/components/ui/spinner";
import { CategoryBadge } from "@/components/ui/category-badge";
import { STEP_HUES, STEP_ICONS, STEP_LABEL_KEYS, stepPreview } from "@/lib/workflow-step-meta";
import type { N8nImport, N8nImportWarning } from "@/lib/n8n-workflow";
import { useT } from "@/lib/i18n/provider";
import type { WorkflowStep } from "@/lib/types";
import { TRIGGER_LABELS } from "./automation-meta";

/**
 * What an n8n file turned into, shown before anything is saved.
 *
 * The translation is lossy by nature (see lib/n8n-workflow.ts), so the point
 * of this panel is the warnings: every node that was skipped, every credential
 * that stayed behind in n8n, said in one line each. The name is editable here
 * because an n8n workflow is usually still called "My workflow".
 */
export function N8nImportDialog({
  fileName,
  preview,
  creating,
  onConfirm,
}: {
  readonly fileName: string;
  readonly preview: N8nImport;
  readonly creating: boolean;
  readonly onConfirm: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(preview.name);

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle icon={<HugeiconsIcon icon={FileImportIcon} size={18} strokeWidth={1.75} />}>
          {t("automations.importTitle")}
        </DialogTitle>
        <DialogDescription>{t("automations.importDescription")}</DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !creating) onConfirm(name.trim());
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("automations.name")}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
        </label>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">{t("automations.importFile")}</dt>
          <dd className="min-w-0 truncate font-mono text-[11px]">{fileName}</dd>
          <dt className="text-muted-foreground">{t("automations.trigger")}</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            <span className="font-medium">{t(TRIGGER_LABELS[preview.trigger])}</span>
            {preview.triggerValue ? (
              <code className="truncate rounded bg-muted px-1 py-px font-mono text-[10px]">{preview.triggerValue}</code>
            ) : null}
          </dd>
        </dl>

        {preview.fromOruka ? (
          <p className="flex items-center gap-1.5 text-xs text-[color:var(--status-success-fg)]">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} />
            {t("automations.importFromOruka")}
          </p>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-xs font-medium">
            {t("automations.workflowSteps")}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {t("automations.stepCount", { count: countSteps(preview.steps) })}
            </span>
          </h3>
          {preview.steps.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
              <div className="y-fade max-h-56 overflow-y-auto p-2">
                <StepList steps={preview.steps} />
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t("automations.importNoSteps")}
            </p>
          )}
        </section>

        {preview.warnings.length > 0 ? (
          <section
            className="space-y-1.5 rounded-lg border border-border/60 bg-[var(--status-pending-bg)] p-3"
            aria-labelledby="n8n-import-warnings"
          >
            <h3
              id="n8n-import-warnings"
              className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--status-pending-fg)]"
            >
              <HugeiconsIcon icon={AlertCircleIcon} size={14} strokeWidth={1.75} />
              {t("automations.importWarningsTitle")}
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-foreground/80">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warningText(t, warning)}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={creating}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={!name.trim() || creating}>
            {creating ? (
              <>
                <Spinner size={14} />
                {t("automations.importing")}
              </>
            ) : (
              t("automations.importConfirm")
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function StepList({ steps, depth = 0 }: { readonly steps: readonly WorkflowStep[]; readonly depth?: number }) {
  const t = useT();
  return (
    <ol className={depth > 0 ? "mt-1 space-y-1 border-l border-border pl-3" : "space-y-1"}>
      {steps.map((step) => {
        const preview = stepPreview(step);
        return (
          <li key={step.id} className="text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <CategoryBadge hue={STEP_HUES[step.type]} className="shrink-0">
                <HugeiconsIcon icon={STEP_ICONS[step.type]} size={12} strokeWidth={1.75} aria-hidden="true" />
                {t(STEP_LABEL_KEYS[step.type])}
              </CategoryBadge>
              {preview ? <span className="min-w-0 truncate text-muted-foreground">{preview}</span> : null}
            </div>
            {step.thenSteps?.length ? (
              <div className="mt-1 pl-2">
                <p className="text-[10px] font-medium text-muted-foreground">{t("automations.branchYes")}</p>
                <StepList steps={step.thenSteps} depth={depth + 1} />
              </div>
            ) : null}
            {step.elseSteps?.length ? (
              <div className="mt-1 pl-2">
                <p className="text-[10px] font-medium text-muted-foreground">{t("automations.branchNo")}</p>
                <StepList steps={step.elseSteps} depth={depth + 1} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function countSteps(steps: readonly WorkflowStep[]): number {
  return steps.reduce(
    (sum, step) => sum + 1 + countSteps(step.thenSteps ?? []) + countSteps(step.elseSteps ?? []),
    0,
  );
}

function warningText(t: ReturnType<typeof useT>, warning: N8nImportWarning): string {
  const key = `automations.importWarn.${warning.code}`;
  switch (warning.code) {
    case "unsupported_node":
      return t(key, { node: warning.node, type: warning.nodeType });
    case "trigger_fallback":
    case "trigger_other_service":
      return t(key, { type: warning.nodeType });
    case "schedule_utc":
      return t(key);
    default:
      return t(key, { node: warning.node });
  }
}
