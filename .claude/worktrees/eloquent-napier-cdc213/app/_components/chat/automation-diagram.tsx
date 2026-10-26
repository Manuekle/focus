"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import nodeStyles from "@/components/ai-elements/flow-node.module.css";
import { countProposalSteps, type AutomationProposal, type AutomationProposalStep } from "@/lib/automation-proposal";
import { pointAlongPolyline, roundedPolyline, routePoints } from "@/lib/flow-edge-path";
import { useAppLocale, useT } from "@/lib/i18n/provider";
import type { WorkflowStep } from "@/lib/types";
import { layoutChain, NODE_H, NODE_W, type LayoutEdge, type XY } from "@/lib/workflow-layout";
import { STEP_CATEGORY_KEYS, STEP_HUES, STEP_ICONS, STEP_LABEL_KEYS } from "@/lib/workflow-step-meta";
import type { StepPath } from "@/lib/workflow-tree";
import { cn } from "@/lib/utils";
import { CHANNEL_LABELS } from "../channel-badge";
import { stepText, TRIGGER_ICONS, TRIGGER_LABELS, triggerSummary } from "./automation-text";
import styles from "./proposal-blueprint.module.css";

/**
 * A proposed automation drawn as the flow it will run: the trigger on top,
 * then every step, condition branches forking into "Sí" and "No" — the same
 * layout engine (lib/workflow-layout.ts) and node look as the canvas in
 * Automatizaciones, so what the owner approves here is what they will find
 * there. Read-only: editing is the canvas's job.
 *
 * `shown` counts nodes in the order the flow runs (trigger first), and a
 * connector draws itself as the node it leads to lands. While the proposal is
 * open the blueprint advances it node by node; settled, it is just drawn.
 */

const TRIGGER_GAP = 56;
const PAD = 16;
/** The trigger has no step type; amber is the automations accent. */
const TRIGGER_HUE = 65;
const SLOT_W = 88;
const SLOT_H = 28;
/** Below this the node text is too small to read: scroll instead. */
const MIN_SCALE = 0.78;

type DiagramNode = {
  readonly key: string;
  readonly order: number;
  readonly x: number;
  readonly y: number;
  readonly kind: "trigger" | "step";
  readonly step?: AutomationProposalStep;
};

type DiagramEdge = {
  readonly key: string;
  readonly d: string;
  readonly label?: { readonly text: "Sí" | "No"; readonly at: XY };
  /** The node whose arrival draws this connector. */
  readonly order: number;
  /** Into an empty branch: dashed, ending on a "nothing" pill. */
  readonly empty?: XY;
};

/** How many units the diagram is drawn in: the trigger, then every step. */
export function automationDiagramSteps(proposal: AutomationProposal): number {
  return 1 + countProposalSteps(proposal.steps);
}

/** The step drawn at position `order` (0 is the trigger), for the footer's
 *  "Agregando…" line. */
export function automationDiagramStepAt(proposal: AutomationProposal, order: number): AutomationProposalStep | null {
  if (order <= 0) return null;
  let seen = 0;
  const walk = (steps: readonly AutomationProposalStep[]): AutomationProposalStep | null => {
    for (const step of steps) {
      seen += 1;
      if (seen === order) return step;
      const found = walk(step.thenSteps) ?? walk(step.elseSteps);
      if (found) return found;
    }
    return null;
  };
  return walk(proposal.steps);
}

function asWorkflow(steps: readonly AutomationProposalStep[], prefix: string): WorkflowStep[] {
  return steps.map((step, index) => ({
    id: `${prefix}${index}`,
    type: step.type,
    config: step.config,
    ...(step.type === "condition"
      ? {
          thenSteps: asWorkflow(step.thenSteps, `${prefix}${index}t`),
          elseSteps: asWorkflow(step.elseSteps, `${prefix}${index}e`),
        }
      : {}),
  }) as WorkflowStep);
}

function stepAt(steps: readonly AutomationProposalStep[], path: StepPath): AutomationProposalStep | undefined {
  let list = steps;
  let current: AutomationProposalStep | undefined;
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (segment === "then") list = current?.thenSteps ?? [];
    else if (segment === "else") list = current?.elseSteps ?? [];
    else current = list[segment as number];
  }
  return current;
}

const pathKey = (path: StepPath | null | undefined) => (path ? path.join(".") : "trigger");

function buildDiagram(proposal: AutomationProposal) {
  const triggerBottom: XY = { x: 0, y: NODE_H };
  const layout = layoutChain(asWorkflow(proposal.steps, "s"), [], 0, NODE_H + TRIGGER_GAP, triggerBottom, null);

  const nodes: DiagramNode[] = [{ key: "trigger", order: 0, x: 0, y: 0, kind: "trigger" }];
  const orderOf = new Map<string, number>([["trigger", 0]]);
  layout.nodes.forEach((node, index) => {
    const key = pathKey(node.path);
    orderOf.set(key, index + 1);
    nodes.push({ key, order: index + 1, x: node.x, y: node.y, kind: "step", step: stepAt(proposal.steps, node.path) });
  });

  const edges: DiagramEdge[] = layout.edges.map((edge: LayoutEdge, index) => {
    const points = routePoints(edge.from, "bottom", edge.to, "top");
    const order = edge.toPath ? orderOf.get(pathKey(edge.toPath)) ?? 0 : orderOf.get(pathKey(edge.fromPath)) ?? 0;
    return {
      key: `${pathKey(edge.fromPath)}->${edge.toPath ? pathKey(edge.toPath) : `slot${index}`}`,
      d: roundedPolyline(points),
      order,
      ...(edge.label ? { label: { text: edge.label, at: pointAlongPolyline(points, 0.55).point } } : {}),
      ...(edge.toSlot ? { empty: edge.to } : {}),
    };
  });

  let minX = -NODE_W / 2;
  let maxX = NODE_W / 2;
  let maxY = NODE_H;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - NODE_W / 2);
    maxX = Math.max(maxX, node.x + NODE_W / 2);
    maxY = Math.max(maxY, node.y + NODE_H);
  }
  for (const edge of edges) {
    if (!edge.empty) continue;
    minX = Math.min(minX, edge.empty.x - SLOT_W / 2);
    maxX = Math.max(maxX, edge.empty.x + SLOT_W / 2);
    maxY = Math.max(maxY, edge.empty.y + SLOT_H);
  }
  return {
    nodes,
    edges,
    offset: { x: -minX + PAD, y: PAD },
    width: maxX - minX + PAD * 2,
    height: maxY + PAD * 2,
  };
}

export function AutomationDiagram({
  proposal,
  shown,
}: {
  readonly proposal: AutomationProposal;
  /** Nodes on the sheet so far, trigger first. */
  readonly shown: number;
}) {
  const t = useT();
  const { locale } = useAppLocale();
  const markerId = useId().replace(/:/g, "");
  const diagram = useMemo(() => buildDiagram(proposal), [proposal]);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFrameWidth(frame.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Never enlarged: a two-step flow keeps its real size instead of filling
  // the card with giant nodes. A wide fork scales down to fit the chat column,
  // but not below the size its 11px text stays readable at; past that the
  // diagram scrolls sideways instead (on a phone, a fork of two columns).
  const fit = frameWidth > 0 ? frameWidth / diagram.width : 1;
  const scale = Math.min(1, Math.max(MIN_SCALE, fit));
  const overflows = frameWidth > 0 && diagram.width * scale > frameWidth + 1;
  // A scrolled diagram opens on its spine, not its left edge: the trigger and
  // the steps under it are centered, the branches reach out to both sides.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame && overflows) frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) / 2;
  }, [overflows]);
  const channel = proposal.channel === "all"
    ? t("proposal.automation.channelAllShort")
    : CHANNEL_LABELS[proposal.channel] ?? proposal.channel;

  return (
    <div
      aria-label={t("proposal.automation.diagramLabel")}
      className={cn("relative w-full", overflows ? "x-fade overflow-x-auto overflow-y-hidden scrollbar-hide" : "overflow-hidden")}
      ref={frameRef}
      role="img"
      style={{ height: diagram.height * scale }}
    >
      <div
        className="relative mx-auto"
        style={{ width: diagram.width * scale, height: diagram.height * scale }}
      >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: diagram.width, height: diagram.height, transform: `scale(${scale})` }}
      >
        <svg aria-hidden="true" className="absolute inset-0 overflow-visible" height={diagram.height} width={diagram.width}>
          <defs>
            <marker id={markerId} markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4" viewBox="0 0 8 8">
              <path className="fill-muted-foreground/60" d="M0,0 L8,4 L0,8 z" />
            </marker>
          </defs>
          <g transform={`translate(${diagram.offset.x} ${diagram.offset.y})`}>
            {diagram.edges.map((edge) => (
              <path
                className={cn(styles.diagramEdge, "fill-none stroke-muted-foreground/45")}
                d={edge.d}
                data-shown={edge.order < shown ? "true" : "false"}
                key={edge.key}
                markerEnd={edge.empty ? undefined : `url(#${markerId})`}
                pathLength={1}
                strokeDasharray={edge.empty ? "0.04 0.03" : "1"}
                strokeWidth={1.5}
              />
            ))}
          </g>
        </svg>

        {diagram.edges.map((edge) =>
          edge.label ? (
            <span
              className={cn(
                styles.diagramNode,
                "absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 py-px text-[10px] font-medium",
                edge.label.text === "Sí"
                  ? "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950 dark:text-emerald-300"
                  : "border-border bg-card text-muted-foreground",
              )}
              data-shown={edge.order < shown ? "true" : "false"}
              key={`${edge.key}:label`}
              style={{ left: edge.label.at.x + diagram.offset.x, top: edge.label.at.y + diagram.offset.y }}
            >
              {edge.label.text === "Sí" ? t("proposal.automation.yes") : t("proposal.automation.no")}
            </span>
          ) : null,
        )}

        {diagram.edges.map((edge) =>
          edge.empty ? (
            <span
              className={cn(
                styles.diagramNode,
                "absolute grid -translate-x-1/2 place-items-center rounded-full border border-dashed border-border bg-card text-[11px] text-muted-foreground",
              )}
              data-shown={edge.order < shown ? "true" : "false"}
              key={`${edge.key}:empty`}
              style={{
                left: edge.empty.x + diagram.offset.x,
                top: edge.empty.y + diagram.offset.y,
                width: SLOT_W,
                height: SLOT_H,
              }}
            >
              {t("proposal.automation.branchEmptyShort")}
            </span>
          ) : null,
        )}

        {diagram.nodes.map((node) => {
          const on = node.order < shown;
          const step = node.step;
          const hue = step ? STEP_HUES[step.type] : TRIGGER_HUE;
          const icon = step ? STEP_ICONS[step.type] : TRIGGER_ICONS[proposal.trigger];
          const label = step ? t(STEP_LABEL_KEYS[step.type]) : t(TRIGGER_LABELS[proposal.trigger]);
          const badge = step ? t(STEP_CATEGORY_KEYS[step.type]) : channel;
          const body = step ? stepText(step, locale) ?? "" : triggerSummary(proposal, locale, t);
          return (
            <div
              className={cn(nodeStyles.tone, "absolute -translate-x-1/2")}
              key={node.key}
              style={{
                ["--flow-hue" as string]: hue,
                left: node.x + diagram.offset.x,
                top: node.y + diagram.offset.y,
                width: NODE_W,
                height: NODE_H,
              }}
            >
              <div
                className={cn(
                  styles.diagramNode,
                  nodeStyles.card,
                  "flex h-full w-full flex-col overflow-hidden rounded-xl border",
                  node.kind === "trigger" && "border-[1.5px]",
                )}
                data-shown={on ? "true" : "false"}
              >
                <span className={cn(nodeStyles.header, "flex w-full shrink-0 items-center gap-1.5 px-2.5 py-1.5")}>
                  <span className="flex size-4.5 shrink-0 items-center justify-center">
                    <HugeiconsIcon aria-hidden="true" icon={icon} size={14} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
                  <span className={cn(nodeStyles.badge, "max-w-[84px] shrink-0 truncate rounded-full px-1.5 py-0.5 font-mono text-[8px] tracking-[0.06em] uppercase")}>
                    {badge}
                  </span>
                </span>
                <span className={cn(nodeStyles.body, "mx-[5px] mb-[5px] flex min-h-0 flex-1 items-center self-stretch rounded-[11px] px-2 py-1")}>
                  <span className="line-clamp-2 text-[11px] leading-snug break-words">{body}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
