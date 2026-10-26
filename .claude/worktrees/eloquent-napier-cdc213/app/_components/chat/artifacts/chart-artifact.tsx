"use client";

import { useEffect, useState } from "react";
import type { ChartSpec } from "@/lib/artifacts";
import { chartSeriesNames, chartSpecToMermaid } from "@/lib/chart-mermaid";
import { relabelLegend, renderDiagramSvg } from "@/lib/mermaid-svg";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";
import { cn } from "@/lib/utils";

/**
 * Every chart in the console, drawn by Mermaid.
 *
 * This used to be seven hundred lines of hand-built SVG: its own axis ticks,
 * its own bar radius, its own pie wedges assembled from triangles, its own
 * hover state and a "ver tabla" toggle. It worked, and it was a second chart
 * language sitting a few centimetres below replies whose diagrams came out of
 * `beautiful-mermaid` — different type size, different tick density, different
 * answer to "does that bar reach the line". You notice it without being able
 * to say why.
 *
 * So there is one renderer now. `xychart-beta`
 * (https://agents.craft.do/mermaid) through the same call as every ```mermaid
 * fence, which also means `lib/report-pdf.ts` can draw the identical chart on
 * paper from the identical source.
 *
 * Two consequences worth naming:
 *
 *   - **No pie.** `xychart` has bars and lines. A `pie`/`donut` spec is ranked
 *     into horizontal bars by `chartSpecToMermaid` — the same question, in the
 *     form that reads better anyway.
 *   - **Hover replaces the table toggle.** The exact values used to live
 *     behind a button; `interactive` is the renderer's own tooltip, so they
 *     live on the bar.
 *
 * The title is set here rather than by `title` in the Mermaid source: headings
 * in this app are Cooper, and `xychart` would set its own in Inter.
 */
export function ChartArtifact({
  className,
  framed = true,
  spec,
}: {
  readonly className?: string;
  /**
   * Whether to draw the console's card frame around it.
   *
   * On its own in the transcript a chart is an object the agent produced, and
   * it wears the same frame as every other card. Inside a report it is a
   * figure in a document that has deliberately no rules, no boxes and no
   * rounded corners anywhere — see ./report-artifact — so there it goes bare.
   */
  readonly framed?: boolean;
  readonly spec: ChartSpec;
}) {
  const svg = useChartSvg(spec);

  const caption = (
    <figcaption className="space-y-0.5">
      <div className="font-cooper text-[15px] text-foreground leading-snug">{spec.title}</div>
      {spec.subtitle ? (
        <div className="text-[12px] text-muted-foreground">{spec.subtitle}</div>
      ) : null}
    </figcaption>
  );

  // The box is reserved at the aspect the renderer produces, so the prose
  // below it does not jump when the SVG arrives. It arrives one render after
  // the card does — an effect, so Mermaid stays off the first paint — and
  // used to appear in a single frame, which in a framed card reads as the
  // card glitching rather than as the chart finishing.
  const plot = (
    <div
      aria-label={spec.title}
      className={cn(
        "w-full transition-opacity duration-200 ease-out motion-reduce:transition-none [&>svg]:h-auto [&>svg]:w-full",
        svg ? "opacity-100" : "opacity-0",
      )}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      role="img"
      style={svg ? undefined : { aspectRatio: "16 / 10" }}
    />
  );

  if (!framed) {
    return (
      <figure className={cn("my-3 space-y-3", className)}>
        {caption}
        {plot}
        {spec.note ? (
          <p className="max-w-[62ch] text-[12.5px] text-muted-foreground leading-relaxed">
            {spec.note}
          </p>
        ) : null}
      </figure>
    );
  }

  return (
    <FramedCard as="figure" className={cn("my-3", className)}>
      <FramedCardPanel className="space-y-3 p-4 sm:p-5">
        {caption}
        {plot}
      </FramedCardPanel>

      {/* The note is a caption on the chart, not part of it: it belongs in the
          frame's gap, the same place a settings card keeps its status line. */}
      {spec.note ? (
        <FramedCardFooter className="pb-1.5">
          <p className="max-w-[62ch] leading-relaxed">{spec.note}</p>
        </FramedCardFooter>
      ) : null}
    </FramedCard>
  );
}

/**
 * Rendered in an effect rather than in `useMemo`.
 *
 * The renderer is synchronous underneath and fast enough to call during
 * render, but it is also the module that carries elkjs — the flowchart layout
 * engine no chart ever reaches. Keeping the call in an effect keeps it off the
 * first paint of a conversation that may contain several of these.
 */
function useChartSvg(spec: ChartSpec): string | null {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const source = chartSpecToMermaid(spec, { title: false });
    renderDiagramSvg(source, { interactive: true, padding: 4 })
      .then((rendered) => {
        if (live) setSvg(relabelLegend(rendered, chartSeriesNames(spec)));
      })
      .catch(() => {
        if (live) setSvg(null);
      });
    return () => {
      live = false;
    };
  }, [spec]);

  return svg;
}
