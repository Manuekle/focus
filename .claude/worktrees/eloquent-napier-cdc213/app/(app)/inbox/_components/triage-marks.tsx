"use client";

// The two pieces of the inbox row that show what Jev read — see
// lib/triage-view.ts for the reading, lib/triage.ts for the writing.
//
// Pulled out of the page because the page is nine hundred lines of list,
// dialogs and CSV export, and because these two are the only part of it with
// no data fetching in them: given a reading they render, which is what makes
// them worth looking at on their own.

import { StatusBadge } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/provider";
import {
  BUYING_SIGNAL_MARK,
  hasTriageMarks,
  urgencyBand,
  type TriageReading,
} from "@/lib/triage-view";

/** Urgency band -> the pill the rest of the app already uses for that weight. */
const URGENCY_STATUS = {
  now: "error",
  soon: "warning",
  today: "pending",
} as const;

/**
 * What Jev read, as pills on the row.
 *
 * Only ever two, and often none: a `calm` urgency is the default state of a
 * message and a pill saying so would be a pill on every row, which is the same
 * as no pill at all but noisier. The point of the list is that the rows which
 * differ look different.
 */
export function TriageBadges({ reading }: { reading: TriageReading | null }) {
  const t = useT();
  if (!reading || !hasTriageMarks(reading)) return null;
  const band = reading.urgency === null ? null : urgencyBand(reading.urgency);
  const buying = (reading.buyingSignal ?? 0) >= BUYING_SIGNAL_MARK;
  return (
    <>
      {band !== null && band !== "calm" && (
        <StatusBadge status={URGENCY_STATUS[band]} label={t(`inbox.triage.${band}`)} />
      )}
      {buying && <StatusBadge status="active" label={t("inbox.triage.buying")} />}
    </>
  );
}

/**
 * The same reading, spelled out, inside the expanded card.
 *
 * Probabilities as percentages and urgency as its rubric word, because the
 * person reading this is deciding who to answer next, not tuning a threshold.
 * The raw numbers stayed legible for exactly one audience — whoever was
 * debugging the integration — and they are still one `triage.` key away in the
 * store for that.
 */
export function TriageDetail({ reading }: { reading: TriageReading }) {
  const t = useT();
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <div className="mt-2">
      <p className="font-medium text-foreground">{t("inbox.triage.title")}:</p>
      {reading.intent && (
        <p>
          {t("inbox.triage.intentLabel")}: {t(`inbox.triage.intent.${reading.intent}`)}
        </p>
      )}
      {reading.urgency !== null && (
        <p>
          {t("inbox.triage.urgencyLabel")}: {t(`inbox.triage.${urgencyBand(reading.urgency)}`)} (
          {reading.urgency.toFixed(1)}/3)
        </p>
      )}
      {reading.needsHuman !== null && (
        <p>
          {t("inbox.triage.needsHumanLabel")}: {percent(reading.needsHuman)}
        </p>
      )}
      {reading.buyingSignal !== null && (
        <p>
          {t("inbox.triage.buyingSignalLabel")}: {percent(reading.buyingSignal)}
        </p>
      )}
    </div>
  );
}
