"use client";

import { useMemo, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message-response";
import type { ReportKpi, ReportSection, ReportSpec, ReportTable } from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";
import { ChartArtifact } from "./chart-artifact";

/**
 * A report, set as a document rather than as a long message.
 *
 * The distinction is the whole point of the thing. A chat reply is read once,
 * top to bottom, and then scrolls away. A report is skimmed for its headline
 * figures, opened at the section somebody cares about, and forwarded to
 * somebody else.
 *
 * ## The typography is the design
 *
 * Three faces, each with one job, and nothing else carrying meaning:
 *
 *   - **Cooper** for anything that names something — the title, the section
 *     headings, the KPI figures. It is the only display face in the app and it
 *     is what makes a report look like a paper rather than a panel.
 *   - **Inter** for prose, at a measure that stops around 68 characters.
 *   - **Geist Mono** for the furniture and the data — the running head, the
 *     section numbers, table figures, deltas. Anything a reader compares down
 *     a column is monospaced, so the columns line up.
 *
 * There are no rules, no boxes, no icons and no rounded corners anywhere in
 * here. A printed document separates things with space and with type, and once
 * the space is right the lines are redundant; once they are gone, the rest of
 * the page has to be genuinely aligned, which is most of what makes it read as
 * considered. The KPI band is the one exception, and it uses flat tone rather
 * than outline for the same reason.
 *
 * ## The PDF
 *
 * Generated on demand from the same spec by `app/api/reports/pdf/route.ts`,
 * with the spec posted back from here — and set in the same three faces, from
 * the same files (`lib/report-pdf.ts`). Nothing is stored: the card in the
 * conversation already holds the document, so a server-side copy would only
 * add an id to expire and a job to clean up.
 *
 * The failure path is deliberately visible. A download that silently does
 * nothing reads as a broken button, and the operator's next move is to ask the
 * agent to make the report again — which costs a model call to produce a
 * document they already have.
 */

/** Past this, the sections start collapsed — a ten-section report would bury the chat. */
const AUTO_EXPAND_SECTIONS = 3;

type DownloadState = "error" | "idle" | "working";

export function ReportArtifact({ spec }: { readonly spec: ReportSpec }) {
  const [expanded, setExpanded] = useState(spec.sections.length <= AUTO_EXPAND_SECTIONS);
  const [download, setDownload] = useState<DownloadState>("idle");

  const onDownload = async () => {
    setDownload("working");
    try {
      const response = await fetch("/api/reports/pdf", {
        body: JSON.stringify(spec),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = `${filename(spec.title)}.pdf`;
      anchor.href = url;
      anchor.click();
      // Revoked on the next frame: Safari has not finished reading the blob
      // when `click()` returns, and revoking synchronously gives an empty file.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
      setDownload("idle");
    } catch {
      setDownload("error");
    }
  };

  return (
    <FramedCard as="article" className="my-3">
      {/* The download is not part of the document — it acts on it — so it sits
          in the frame's gap, where a settings card keeps its action, and above
          the panel rather than below: the document runs for thousands of
          pixels and the button has to be where the reader starts. */}
      <FramedCardFooter className="justify-end" place="top">
        <button
          className="rp-eyebrow inline-flex min-h-8 items-center rounded-md px-1.5 text-foreground transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
          disabled={download === "working"}
          onClick={() => void onDownload()}
          type="button"
        >
          {download === "working"
            ? "Generando…"
            : download === "error"
              ? "Reintentar PDF"
              : "Descargar PDF"}
        </button>
      </FramedCardFooter>

      <FramedCardPanel className="px-5 py-6 text-foreground sm:px-8 sm:py-9">
        <header className="space-y-5">
          <p className="rp-eyebrow">{[spec.period, "Informe"].filter(Boolean).join(" · ")}</p>

          <div className="space-y-2">
            <h3 className="font-cooper text-[26px] leading-[1.12] tracking-[-0.01em] sm:text-[32px]">
              {spec.title}
            </h3>
            {spec.subtitle ? (
              <p className="max-w-[60ch] text-[14px] text-muted-foreground leading-relaxed">
                {spec.subtitle}
              </p>
            ) : null}
          </div>
        </header>

        {spec.kpis?.length ? <KpiBento kpis={spec.kpis} /> : null}

        <section className="mt-8 space-y-2.5">
          <p className="rp-eyebrow">Resumen</p>
          <MessageResponse className="rp-prose">{spec.summary}</MessageResponse>
        </section>

        {expanded ? (
          <div className="mt-9 space-y-9">
            {spec.sections.map((section, index) => (
              <Section index={index} key={section.heading} section={section} />
            ))}
          </div>
        ) : (
          <button
            className="mt-8 w-full space-y-2 text-left transition-opacity hover:opacity-70"
            onClick={() => setExpanded(true)}
            type="button"
          >
            <p className="rp-eyebrow">Contenido · {spec.sections.length} secciones</p>
            <p className="font-cooper text-[15px] text-foreground leading-snug">
              {spec.sections.map((section) => section.heading).join(" · ")}
            </p>
          </button>
        )}

        {spec.footnote ? (
          <p className="mt-9 max-w-[70ch] font-mono text-[11px] text-muted-foreground leading-relaxed">
            {spec.footnote}
          </p>
        ) : null}
      </FramedCardPanel>
    </FramedCard>
  );
}

/**
 * The headline figures, as a bento band.
 *
 * Six columns, and each count gets its own run of spans so the row always
 * fills — a three-up grid with a hole in it where a fourth KPI would go is the
 * failure mode of every equal-column layout, and it reads as a number that
 * failed to load. The first figure is set larger whatever the count, because
 * the model is asked to put the headline first and the layout should agree
 * with it.
 *
 * Flat tone, no outline: a border here would be the only one in the document.
 */
const KPI_SPANS: Readonly<Record<number, readonly number[]>> = {
  1: [6],
  2: [3, 3],
  3: [2, 2, 2],
  4: [3, 3, 3, 3],
  5: [2, 2, 2, 3, 3],
  6: [2, 2, 2, 2, 2, 2],
};

const SPAN_CLASS: Readonly<Record<number, string>> = {
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  6: "sm:col-span-6",
};

function KpiBento({ kpis }: { readonly kpis: readonly ReportKpi[] }) {
  const spans = KPI_SPANS[kpis.length] ?? kpis.map(() => 2);

  return (
    <dl className="mt-8 grid grid-cols-2 gap-1.5 sm:grid-cols-6">
      {kpis.map((kpi, index) => (
        <div
          className={cn(
            "bg-[var(--muted)] px-4 py-4",
            SPAN_CLASS[spans[index] ?? 2],
            index === 0 ? "col-span-2" : null,
          )}
          key={kpi.label}
        >
          <dt className="rp-eyebrow truncate">{kpi.label}</dt>
          <dd className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "font-cooper leading-none tracking-[-0.01em]",
                index === 0 ? "text-[30px] sm:text-[36px]" : "text-[24px] sm:text-[27px]",
              )}
            >
              {kpi.value}
            </span>
            {kpi.delta ? (
              <span className={cn("font-mono text-[11px] tabular-nums", deltaTone(kpi.tone))}>
                {kpi.delta}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Tone says what the number means, not what it is — a rising cost is a warning
 * even though it is a bigger number. Defaults to muted, so an unlabelled delta
 * reads as information rather than as good news.
 */
function deltaTone(tone: ReportKpi["tone"]): string {
  switch (tone) {
    case "positive":
      return "text-emerald-700 dark:text-emerald-400";
    case "warning":
      return "text-amber-700 dark:text-amber-400";
    case "critical":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function Section({ index, section }: { readonly index: number; readonly section: ReportSection }) {
  return (
    <section className="space-y-3">
      {/* The number is the only ornament in the document, and it earns its
          place: it is what somebody points at when they say which part of the
          report they mean. */}
      <div className="flex items-baseline gap-3">
        <span className="rp-eyebrow shrink-0 pt-[3px] text-muted-foreground/70">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h4 className="font-cooper text-[19px] leading-snug tracking-[-0.01em]">
          {section.heading}
        </h4>
      </div>

      <div className="space-y-5 sm:pl-[calc(1.5rem+0.75rem)]">
        {section.body ? <MessageResponse className="rp-prose">{section.body}</MessageResponse> : null}
        {section.table ? <Table table={section.table} /> : null}
        {section.chart ? <ChartArtifact className="my-0" framed={false} spec={section.chart} /> : null}
      </div>
    </section>
  );
}

/**
 * A table with no rules in it.
 *
 * What keeps a lineless table readable is the columns actually lining up, so
 * any column whose cells all read as figures is set in Geist Mono and pushed
 * right; the rest stay in Inter, left. That single decision does the work the
 * borders used to: the eye follows the right edge of a numeric column without
 * anything drawn to guide it.
 */
function Table({ table }: { readonly table: ReportTable }) {
  const numeric = useMemo(() => numericColumns(table), [table]);

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[28rem] border-separate border-spacing-0">
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th
                className={cn(
                  "rp-eyebrow whitespace-nowrap pb-2 pr-5 align-bottom font-normal last:pr-0",
                  numeric[index] ? "text-right" : "text-left",
                )}
                key={column}
                scope="col"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            // Rows are opaque strings from the model with no id of their own,
            // and two identical rows are legitimate data, so the index is the
            // only stable key available.
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  className={cn(
                    "py-1.5 pr-5 align-top text-[13px] leading-snug last:pr-0",
                    numeric[cellIndex]
                      ? "text-right font-mono tabular-nums"
                      : "text-left text-foreground",
                  )}
                  key={cellIndex}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A figure, for alignment purposes: an optional sign and symbol around digits,
 * with the separators, the decimal and a trailing unit allowed. Deliberately
 * loose — "1.480.000", "-4 %", "$ 12,5k" and "12 días" all belong on the right
 * of a column; a sentence does not.
 */
const FIGURE = /^[+\-−]?\s*[$€£¥]?\s*\d[\d.,\s]*\s*(?:%|[a-zA-Z]{1,6})?$/;

function numericColumns(table: ReportTable): readonly boolean[] {
  return table.columns.map((_column, index) => {
    const cells = table.rows.map((row) => row[index]?.trim()).filter((cell) => cell);
    return cells.length > 0 && cells.every((cell) => FIGURE.test(cell!));
  });
}

function filename(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "informe"
  );
}
