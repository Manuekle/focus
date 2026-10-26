"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { MessageCircleIcon, SentIcon } from "@hugeicons/core-free-icons";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ReadinessCheck } from "@/lib/agent-brief";
import { FLOW_BANDS, SECTION_ICONS, type SectionId } from "./agent-sections";

export type { SectionId };

// The agent, drawn as the flow it runs.
//
// Same canvas as an automation — the dotted ground, the same node card, the
// same 1px connectors — and none of the dragging, because the two are not the
// same kind of object. A flow's shape *is* what you edit there; an agent's
// shape is fixed, and a canvas you could rearrange would be offering an edit
// that does not exist. So the nodes sit where they belong and clicking one
// opens its editor in the dock.
//
// The reading is honest, top to bottom: a message arrives on a channel, meets
// an agent with a name and a job, is answered under its rules and prompt on
// its model, using the capabilities and the business knowledge it was given.
//
// Monochrome, one line of text per node, nothing floating over it but the
// readiness line. Everything that was decoration is gone.

export type BlueprintSection = {
  readonly id: SectionId;
  /** One line of what is currently saved, or an empty string for "not set". */
  readonly summary: string;
  readonly done: boolean;
  /** Set when something needs attention even though the section is filled in
   *  — a capability whose integration is missing, say. */
  readonly warning?: string;
};

export function AgentBlueprint({
  sections,
  checks,
  selected,
  onSelect,
}: {
  readonly sections: readonly BlueprintSection[];
  readonly checks: readonly ReadinessCheck[];
  readonly selected: SectionId | null;
  readonly onSelect: (id: SectionId) => void;
}) {
  const t = useT();
  const byId = new Map(sections.map((section) => [section.id, section] as const));
  const done = checks.filter((check) => check.done).length;
  const missing = checks.filter((check) => !check.done && !check.optional);

  // Container, not viewport: this canvas shares the row with a dock that is
  // 340–620px wide, so on a 1024px screen with the dock open it gets ~364px
  // while every `sm:` rule used to still fire and lay three nodes across it.
  return (
    <div className="y-fade @container relative h-full overflow-y-auto bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px]">
      {/* Same place, same weight and the same job as the canvas hint on an
          automation: one quiet line that says where you are. */}
      <p className="pointer-events-none absolute top-4 left-4 hidden font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase @min-[720px]:block">
        {done}/{checks.length}
        {missing.length > 0
          ? ` · ${t("builder.stillMissing")} ${missing.map((check) => t(`builder.check.${check.id}`)).join(" · ")}`
          : ` · ${t("builder.readyTitle")}`}
      </p>

      <div className="mx-auto max-w-xl px-4 py-8 @min-[520px]:py-10">
        <Endpoint icon={MessageCircleIcon} label={t("builder.flowIn")} />

        {FLOW_BANDS.map((band, index) => (
          <div key={index}>
            <Connectors from={index === 0 ? 1 : FLOW_BANDS[index - 1].length} to={band.length} />
            <div
              className={cn(
                "grid gap-3",
                band.length === 2 ? "@min-[520px]:grid-cols-2" : null,
                band.length === 3 ? "@min-[520px]:grid-cols-3" : null,
              )}
            >
              {band.map((id) => {
                const section = byId.get(id);
                if (!section) return null;
                return (
                  <FlowNode
                    key={id}
                    section={section}
                    selected={selected === id}
                    onSelect={() => onSelect(id)}
                  />
                );
              })}
            </div>
          </div>
        ))}

        <Connectors from={FLOW_BANDS[FLOW_BANDS.length - 1].length} to={1} />
        <Endpoint icon={SentIcon} label={t("builder.flowOut")} />
      </div>
    </div>
  );
}

/**
 * The rail between two bands: up from the band above, along, and down into the
 * band below.
 *
 * Drawn in CSS at exact column centres rather than as an SVG at measured
 * coordinates. A band is an equal-width grid, so a column's centre is
 * `colWidth * (i + 0.5) + i * gap` — arithmetic `calc()` does for free, at
 * every width, with no measurement and no re-render when the dock is dragged.
 * Doing it as thirds of the container instead is off by a few pixels once the
 * gap is counted, which on a 1px line is the difference between a diagram and
 * a near miss.
 *
 * One rail rather than a converge and a separate fan: everything meets in the
 * middle and spreads out again, which is both simpler to draw and truer to
 * what happens — all of this is one agent.
 *
 * Below `sm` the bands stack into a single column, so it collapses to the
 * straight connector a chain gets.
 */
const GAP = "0.75rem"; // matches `gap-3` on the bands

/** Width of one column in an `n`-column band. */
const columnWidth = (n: number) => `((100% - ${n - 1} * ${GAP}) / ${n})`;

/** Centre of column `i`, as a CSS length from the band's left edge. */
const columnCenter = (i: number, n: number) =>
  `calc(${columnWidth(n)} * ${i + 0.5} + ${i} * ${GAP})`;

function Connectors({ from, to }: { readonly from: number; readonly to: number }) {
  const spread = Math.max(from, to);
  const straight = from === 1 && to === 1;
  /**
   * Two bands of the same width need no rail: their columns line up, so each
   * one just carries straight on down. Drawing the rail anyway closes a
   * rectangle between the two bands — a box, not a flow — which is exactly
   * what it looked like.
   */
  const railed = from !== to;

  return (
    <div aria-hidden="true">
      <div className={cn("mx-auto h-9 w-px bg-border", straight ? null : "@min-[520px]:hidden")} />
      {straight ? null : (
        <div className="relative hidden h-9 @min-[520px]:block">
          {railed ? (
            // Spans between the outermost column centres in play.
            <span
              className="absolute top-1/2 h-px bg-border"
              style={{
                left: `calc(${columnWidth(spread)} / 2)`,
                right: `calc(${columnWidth(spread)} / 2)`,
              }}
            />
          ) : null}
          {Array.from({ length: from }).map((_, index) => (
            <span
              key={`up-${index}`}
              className="absolute top-0 h-1/2 w-px -translate-x-1/2 bg-border"
              style={{ left: columnCenter(index, from) }}
            />
          ))}
          {Array.from({ length: to }).map((_, index) => (
            <span
              key={`down-${index}`}
              className="absolute top-1/2 h-1/2 w-px -translate-x-1/2 bg-border"
              style={{ left: columnCenter(index, to) }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Where the conversation comes in and goes out. Not a node — nothing to
 *  configure — so it is drawn as the canvas draws its edge labels: a pill. */
function Endpoint({
  icon,
  label,
}: {
  readonly icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  readonly label: string;
}) {
  return (
    <div className="flex justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase shadow-[var(--shadow-soft)]">
        <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

/**
 * One decision, as a node.
 *
 * Deliberately the automation node's card, down to the header fill on select
 * and the dashed border on an empty one — a person who has built a flow in
 * this app should not have to learn a second visual language to read an agent.
 */
function FlowNode({
  section,
  selected,
  onSelect,
}: {
  readonly section: BlueprintSection;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-cuelume-select
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left",
        "transition-[border-color,box-shadow] duration-200 ease-out",
        "focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
        section.done ? null : "border-dashed",
        selected
          ? "border-foreground/[0.15] shadow-[var(--shadow-elevated)]"
          : "border-border shadow-[var(--shadow-soft)] hover:border-input hover:shadow-[var(--shadow-elevated)]",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5 transition-colors duration-200",
          selected ? "bg-foreground/[0.07]" : null,
        )}
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
            selected ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground/70",
          )}
        >
          <HugeiconsIcon
            icon={SECTION_ICONS[section.id]}
            size={13}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {t(`builder.section.${section.id}`)}
        </span>
        {/* The one non-monochrome mark on the canvas, and it is the only state
            worth interrupting for: ticked, but its integration is missing. */}
        {section.warning ? (
          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title={section.warning} />
        ) : null}
      </span>
      <span
        className={cn(
          "mx-3 mb-2.5 flex min-h-0 flex-1 items-center pt-2",
          !selected ? "border-t border-border/70" : null,
        )}
      >
        <span
          className={cn(
            "line-clamp-2 text-[11px] leading-snug",
            section.summary ? "text-muted-foreground" : "text-muted-foreground italic",
          )}
        >
          {section.summary || t(`builder.sectionEmpty.${section.id}`)}
        </span>
      </span>
    </button>
  );
}
