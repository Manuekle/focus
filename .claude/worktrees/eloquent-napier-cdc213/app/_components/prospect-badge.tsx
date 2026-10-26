"use client";

import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/provider";
import type { ProspectAssessment, ProspectStage } from "@/lib/types";

/**
 * Where a conversation left the customer, as a pill.
 *
 * It borrows the app's status pill rather than inventing a second badge
 * language: the colour carries the outcome (green closed, red lost, amber
 * still open) and the label carries the wording, which is what a sales list
 * is read by.
 */
const STAGE_VARIANT: Record<ProspectStage, StatusVariant> = {
  won: "success",
  lost: "failed",
  negotiating: "in-progress",
  interested: "submitted",
  no_response: "expired",
  unqualified: "draft",
  support: "in-review",
};

export function ProspectBadge({
  prospect,
  className,
}: {
  readonly prospect: ProspectAssessment | undefined;
  readonly className?: string;
}) {
  const t = useT();
  if (!prospect) {
    return (
      <StatusBadge status="pending" label={t("prospect.stage.unassessed")} className={className} />
    );
  }
  return (
    <StatusBadge
      status={STAGE_VARIANT[prospect.stage] ?? "pending"}
      label={t(`prospect.stage.${prospect.stage}`)}
      // The reason is a sentence; a pill is not the place for it, but it is
      // exactly what someone hovering the pill wants to know.
      title={prospect.reason}
      className={className}
    />
  );
}
