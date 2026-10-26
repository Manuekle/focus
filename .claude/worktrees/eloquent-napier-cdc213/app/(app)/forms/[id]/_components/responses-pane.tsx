"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { UserIcon } from "@hugeicons/core-free-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { useI18n } from "@/lib/i18n/provider";
import { relativeTime } from "@/lib/format";
import type { FormResponse, LeadTemperature } from "@/lib/types";

/** Hot / warm / cold on the same pill system as every other status in the app,
 *  so a rating reads the same way a channel or an automation state does. */
function TemperatureBadge({ temperature }: { readonly temperature: LeadTemperature }) {
  const { t } = useI18n();
  const variant = temperature === "hot" ? "failed" : temperature === "warm" ? "pending" : "expired";
  return <StatusBadge status={variant} label={t(`forms.temperature.${temperature}`)} />;
}

/**
 * The dock's responses tab.
 *
 * A list rather than the wide table this used to be: the dock is a column, and
 * the four columns that table carried were mostly whitespace once they had to
 * fit one. Score, rating and when — the three things you scan for.
 */
export function ResponsesPane({
  responses,
  ceiling,
}: {
  readonly responses: readonly FormResponse[];
  readonly ceiling: number;
}) {
  const { locale, t } = useI18n();

  if (responses.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 text-center">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={UserIcon} size={18} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium">{t("forms.detail.noResponses")}</p>
        <p className="max-w-[34ch] text-[12px] leading-relaxed text-muted-foreground">
          {t("forms.detail.noResponsesHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="y-fade h-full overflow-y-auto scrollbar-hide px-3 pb-4">
      <p className="py-2.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        {t("forms.completedOf", {
          completed: responses.filter((r) => !r.partial).length,
          total: responses.length,
        })}
      </p>

      <ul className="space-y-1.5">
        {responses.map((response) => (
          <li
            key={response.id}
            className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <TemperatureBadge temperature={response.temperature} />
              <span className="text-xs font-medium tabular-nums">
                {t("forms.detail.scoreOf", { score: response.score, max: ceiling })}
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {relativeTime(response.updatedAt, locale)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("forms.builder.answerCount", { count: response.answers.length })}
              {response.partial ? ` · ${t("forms.detail.partial")}` : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
