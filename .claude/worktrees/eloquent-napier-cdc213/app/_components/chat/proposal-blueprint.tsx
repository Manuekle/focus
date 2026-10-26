"use client";

import type { EveDynamicToolPart } from "eve/react";
import { type FormEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import {
  BlueprintIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  DrawingCompassIcon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCelebrate } from "@/components/use-celebrate";
import { approvalOutcome, type InputAnswer } from "@/lib/chat-input-request";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AgentInputResponse } from "../agent-message";
import styles from "./proposal-blueprint.module.css";

/**
 * Something the console chat proposes to build, drawn as the plan an
 * architect lays in front of a client: what it is, section by section, then
 * the decision. `propose_agent` (./agent-proposal-card.tsx) and
 * `propose_automation` (./automation-proposal-card.tsx) supply the sections;
 * this is the sheet, the drawing and the decision they share.
 *
 * ## Why this is not the approval card
 *
 * `InputRequestCard` asks "approve `propose_agent`?" over a JSON disclosure.
 * For a refund that is the honest shape — the arguments are an amount and an
 * id. For an agent or an automation the arguments are the whole thing being
 * decided on. Hiding them behind "Ver qué va a hacer" asks the owner to sign
 * a plan they have not been shown.
 *
 * ## The four moments
 *
 * 1. **Drawn.** The proposal arrives complete (Eve does not stream tool
 *    arguments), so the drawing is staged on the client: the spine grows and
 *    each section lands in reading order, with the footer saying what is being
 *    traced. Only while the decision is open; a settled card is just drawn.
 * 2. **Decided.** Build, request changes, or discard. Changes deny the call
 *    and send the owner's words as the next message in the same request, so
 *    the agent redraws instead of asking what was wrong.
 * 3. **Built.** The tool runs only after the yes. The footer ticks through
 *    what the build does while it runs; the result is a draft, with the way
 *    into it in the footer.
 * 4. **Set aside.** Discarded, or the conversation moved on: the plan stays
 *    readable and quiet, and the stage label says it was not built.
 */

export type ProposalStage = "review" | "building" | "built" | "declined" | "failed" | "closed";

/**
 * Where a proposal stands, from the strongest evidence in the transcript.
 * `isResult` says whether the tool's output is a build the card can link to.
 */
export function proposalStageOf(
  part: EveDynamicToolPart,
  answer: InputAnswer | undefined,
  movedOn: boolean,
  isResult: (output: unknown) => boolean,
): ProposalStage {
  if (part.state === "output-available") return isResult(part.output) ? "built" : "failed";
  if (part.state === "output-error") return "failed";
  if (part.state === "output-denied") return "declined";
  const outcome = approvalOutcome(part, answer);
  if (outcome === "denied") return "declined";
  // Approved and still waiting on the result. If the conversation already
  // went past it without one, there is nothing truthful to show but "closed".
  if (outcome === "approved") return movedOn ? "closed" : "building";
  return movedOn ? "closed" : "review";
}

export type BlueprintSection = {
  /** Stable key for the section. */
  readonly id: string;
  readonly icon: IconSvgElement;
  /** The section's heading on the sheet. */
  readonly label: string;
  /** What the footer says while this section is being drawn. */
  readonly drawing: string;
  readonly body: ReactNode;
};

/** The copy that differs between what is being proposed. */
export type BlueprintCopy = {
  readonly kicker: string;
  readonly ready: string;
  readonly build: string;
  readonly changesPlaceholder: string;
  readonly failed: string;
  readonly built: string;
};

/** The proposal drawn as a picture, alongside the text plan. */
export type BlueprintDiagram = {
  /** Units it is drawn in, in order. */
  readonly steps: number;
  /** What the footer says while unit `index` is being drawn. */
  readonly drawing: (index: number) => string;
  readonly render: (shown: number) => ReactNode;
};

type BlueprintView = "diagram" | "plan";

type Respond = (responses: readonly AgentInputResponse[], message?: string) => void | Promise<void>;

/** Time each section takes to land while the plan is being drawn. */
const DRAW_STEP_MS = 300;
/** Pause before the first line, so the frame is on screen before the ink. */
const DRAW_LEAD_MS = 240;
/** Time each diagram node takes to land: a flow has more nodes than the plan
 *  has sections, so they come a little faster. */
const DIAGRAM_STEP_MS = 260;
/** Cadence of the build checklist while the tool runs. */
const BUILD_STEP_MS = 360;

export function ProposalBlueprint({
  answer,
  avatar,
  builtActions,
  buildSteps,
  canRespond,
  copy,
  description,
  diagram,
  notes = [],
  onInputResponses,
  part,
  sections,
  sheet,
  stage,
  title,
}: {
  readonly answer: InputAnswer | undefined;
  /** The tile in the title block: an icon on its accent. */
  readonly avatar: { readonly icon: IconSvgElement; readonly className: string };
  /** The links into what was built. The one that should catch the
   *  celebration takes `openRef`. */
  readonly builtActions: (openRef: RefObject<HTMLAnchorElement | null>) => ReactNode;
  /** What the build does, in order, ticked off while the tool runs. */
  readonly buildSteps: readonly string[];
  readonly canRespond: boolean;
  readonly copy: BlueprintCopy;
  readonly description?: string;
  /** A diagram view, offered next to the text plan. */
  readonly diagram?: BlueprintDiagram;
  /** The architect's notes under the sheet, when there are any. */
  readonly notes?: readonly string[];
  readonly onInputResponses: Respond;
  readonly part: EveDynamicToolPart;
  readonly sections: readonly BlueprintSection[];
  /** "Lámina 1/3" when the proposal is one of a set. */
  readonly sheet?: string;
  readonly stage: ProposalStage;
  readonly title: string;
}) {
  const t = useT();
  const titleId = useId();
  const reduce = useReducedMotion();
  const celebrate = useCelebrate();
  const openRef = useRef<HTMLAnchorElement>(null);

  const request = part.toolMetadata?.eve?.inputRequest;
  // One step per section, plus one for the notes when there are any.
  const steps = sections.length + (notes.length > 0 ? 1 : 0);

  // What the card looked like when it mounted. A build that differs from it
  // happened in front of the owner and earns the celebration; one read back
  // from history is simply there.
  const [mountStage] = useState(stage);
  // Two ways to read the same proposal: the text plan, and the diagram when
  // the proposal has one (an automation is a flow, so it opens as one). Each
  // view draws itself the first time it is on screen while the decision is
  // open; the decision appears as soon as either has finished.
  const [view, setView] = useState<BlueprintView>(diagram ? "diagram" : "plan");
  const totals: Record<BlueprintView, number> = { plan: steps, diagram: diagram?.steps ?? 0 };
  const live = stage === "review";
  const [drawn, setDrawn] = useState<Record<BlueprintView, number>>(() =>
    live ? { plan: 0, diagram: 0 } : { plan: steps, diagram: diagram?.steps ?? 0 },
  );
  const shown = live ? drawn.plan : steps;
  const diagramShown = live ? drawn.diagram : totals.diagram;
  const ready = !live || drawn.plan >= steps || (diagram !== undefined && drawn.diagram >= totals.diagram);
  const drawing = ready
    ? undefined
    : view === "diagram" && diagram
      ? diagram.drawing(Math.min(diagramShown, totals.diagram - 1))
      : sections[Math.min(shown, sections.length - 1)]?.drawing;

  const target = totals[view];
  const done = drawn[view];
  useEffect(() => {
    if (!live || done >= target) return;
    const step = view === "diagram" ? DIAGRAM_STEP_MS : DRAW_STEP_MS;
    const delay = reduce ? 0 : done === 0 ? DRAW_LEAD_MS : step;
    const timer = window.setTimeout(
      () => setDrawn((current) => ({ ...current, [view]: reduce ? target : current[view] + 1 })),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [done, live, reduce, target, view]);

  useEffect(() => {
    if (stage !== "built" || mountStage === "built") return;
    celebrate({ from: openRef.current });
  }, [celebrate, mountStage, stage]);

  const setAside = stage === "declined" || stage === "closed";
  // Declined with words is a plan sent back for revision, not thrown away.
  const revising = stage === "declined" && Boolean(answer?.text?.trim());

  return (
    <FramedCard
      aria-labelledby={titleId}
      as="section"
      className="my-2"
      data-stage={stage}
      tone={setAside ? "quiet" : "default"}
    >
      <FramedCardPanel className="p-0" tone={setAside ? "quiet" : "default"}>
        {/* Title block — the corner of a drawing that says what it is. */}
        <header className="flex items-start gap-3 border-b border-dashed border-border/80 px-4 py-3.5">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl shadow-[var(--shadow-inset)]",
              avatar.className,
            )}
          >
            <HugeiconsIcon icon={avatar.icon} size={20} strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Wraps rather than truncates: on a phone the stage label drops
                to its own line instead of eating the kicker down to "PLA…". */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap text-muted-foreground uppercase">
              <HugeiconsIcon aria-hidden="true" icon={BlueprintIcon} size={12} strokeWidth={1.75} />
              <span>{copy.kicker}</span>
              {sheet ? (
                <span className="rounded-[4px] border border-border/80 px-1 leading-4 tabular-nums">{sheet}</span>
              ) : null}
              <StageLabel revising={revising} stage={stage} />
            </div>
            <h3
              className={cn(
                "text-[15px] leading-snug font-semibold text-balance",
                setAside ? "text-muted-foreground" : "text-foreground",
              )}
              id={titleId}
            >
              {title}
            </h3>
            {description ? (
              <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </header>

        {diagram ? (
          <div className="flex items-center justify-between gap-3 border-b border-dashed border-border/80 px-4 py-2">
            <SlidingTabs
              onValueChange={(next) => setView(next as BlueprintView)}
              tabs={[
                { id: "diagram", label: t("proposal.view.diagram") },
                { id: "plan", label: t("proposal.view.text") },
              ]}
              value={view}
            />
          </div>
        ) : null}

        {view === "diagram" && diagram ? (
          <div className={cn(styles.sheet, "px-3 py-4", setAside && "opacity-70")}>{diagram.render(diagramShown)}</div>
        ) : (
        /* The sheet. */
        <div className={cn(styles.sheet, "@container relative px-4 pt-4 pb-3", setAside && "opacity-70")}>

          <ol className="relative grid gap-4">
            <span
              aria-hidden="true"
              className={cn(styles.spine, "absolute top-3 bottom-3 left-[11.5px] w-px bg-border")}
              style={{ transform: `scaleY(${sections.length === 0 ? 0 : Math.min(shown, sections.length) / sections.length})` }}
            />
            {sections.map((section, index) => {
              const on = index < shown;
              return (
                <li className={cn(styles.node, "relative pl-9")} data-shown={on ? "true" : "false"} key={section.id}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      styles.marker,
                      "absolute top-0 left-0 grid size-6 place-items-center rounded-full border bg-card",
                      on ? "border-foreground/25 text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    <HugeiconsIcon icon={section.icon} size={12} strokeWidth={1.75} />
                  </span>
                  <p className="flex items-center gap-2 pt-1 font-mono text-[10px] leading-4 tracking-[0.14em] text-muted-foreground uppercase">
                    <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <span className="truncate">{section.label}</span>
                  </p>
                  <div className="mt-1.5 min-w-0">{section.body}</div>
                </li>
              );
            })}
          </ol>
        </div>
        )}

        {notes.length > 0 && view === "plan" ? (
          <aside
            className={cn(styles.node, "border-t border-dashed border-border/80 px-4 py-3")}
            data-shown={shown > sections.length ? "true" : "false"}
          >
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              <HugeiconsIcon aria-hidden="true" icon={DrawingCompassIcon} size={12} strokeWidth={1.75} />
              {t("proposal.notes")}
            </p>
            <ol className="mt-2 grid gap-1.5">
              {notes.map((note, index) => (
                <li className="flex gap-2.5 text-[13px] leading-relaxed text-pretty text-muted-foreground" key={index}>
                  <span
                    aria-hidden="true"
                    className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border border-border font-mono text-[9px] text-muted-foreground tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">{note}</span>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </FramedCardPanel>

      <FramedCardFooter>
        <BlueprintFooter
          answer={answer}
          builtActions={builtActions}
          buildSteps={buildSteps}
          canRespond={canRespond && request !== undefined}
          copy={copy}
          drawing={drawing}
          errorText={part.errorText}
          name={title}
          onInputResponses={onInputResponses}
          openRef={openRef}
          requestId={request?.requestId}
          stage={stage}
        />
      </FramedCardFooter>
    </FramedCard>
  );
}

function StageLabel({ revising, stage }: { readonly revising: boolean; readonly stage: ProposalStage }) {
  const t = useT();
  return (
    <span
      className={cn(
        "ml-auto shrink-0 font-sans text-[11px] font-medium tracking-normal normal-case",
        "transition-colors duration-200 ease-out motion-reduce:transition-none",
        stage === "review"
          ? "text-amber-600 dark:text-amber-400"
          : stage === "building"
            ? "text-blue-600 dark:text-blue-400"
            : stage === "built"
              ? "text-emerald-600 dark:text-emerald-400"
              : stage === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
      )}
    >
      {revising ? t("proposal.stage.revising") : t(`proposal.stage.${stage}`)}
    </span>
  );
}

/**
 * The strip under the sheet: what the architect is doing, then what the owner
 * can do about it, then what came of it.
 */
function BlueprintFooter({
  answer,
  builtActions,
  buildSteps,
  canRespond,
  copy,
  drawing,
  errorText,
  name,
  onInputResponses,
  openRef,
  requestId,
  stage,
}: {
  readonly answer: InputAnswer | undefined;
  readonly builtActions: (openRef: RefObject<HTMLAnchorElement | null>) => ReactNode;
  readonly buildSteps: readonly string[];
  readonly canRespond: boolean;
  readonly copy: BlueprintCopy;
  readonly drawing: string | undefined;
  readonly errorText: string | undefined;
  readonly name: string;
  readonly onInputResponses: Respond;
  readonly openRef: RefObject<HTMLAnchorElement | null>;
  readonly requestId: string | undefined;
  readonly stage: ProposalStage;
}) {
  const t = useT();

  if (stage === "review" && drawing) {
    return (
      <p className="flex min-w-0 items-center gap-2" aria-hidden="true">
        <HugeiconsIcon className="shrink-0" icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />
        <span className="t-shimmer truncate" data-text={drawing}>
          {drawing}
        </span>
      </p>
    );
  }

  if (stage === "review") {
    return (
      <Decision
        canRespond={canRespond}
        copy={copy}
        name={name}
        onInputResponses={onInputResponses}
        requestId={requestId}
      />
    );
  }

  if (stage === "building") return <BuildProgress steps={buildSteps} />;

  if (stage === "built") {
    return (
      <div className={cn(styles.node, "flex w-full flex-wrap items-center gap-x-3 gap-y-2")} role="status">
        <p className="flex min-w-0 flex-1 basis-56 items-center gap-2">
          <HugeiconsIcon
            className="shrink-0 text-emerald-600 dark:text-emerald-400"
            icon={CheckmarkCircle02Icon}
            size={14}
            strokeWidth={1.75}
          />
          <span className="text-pretty">{copy.built}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">{builtActions(openRef)}</div>
      </div>
    );
  }

  if (stage === "declined") {
    const changes = answer?.text?.trim();
    return (
      <p className="flex min-w-0 items-center gap-2" role="status">
        <HugeiconsIcon className="shrink-0" icon={changes ? PencilEdit02Icon : Cancel01Icon} size={14} strokeWidth={1.75} />
        <span className="min-w-0 truncate">
          {changes ? t("proposal.changesNote", { changes }) : t("proposal.declinedNote")}
        </span>
      </p>
    );
  }

  if (stage === "failed") {
    return (
      <p className="flex min-w-0 items-center gap-2 text-destructive" role="status">
        <HugeiconsIcon className="shrink-0" icon={Cancel01Icon} size={14} strokeWidth={1.75} />
        <span className="min-w-0 truncate" title={errorText}>
          {copy.failed}
        </span>
      </p>
    );
  }

  return <p>{t("proposal.closedNote")}</p>;
}

/**
 * Build, request changes, or discard.
 *
 * Build is the primary and sits last, where the eye ends a left-to-right
 * read; discard is a ghost at the far left, as far from the thumb's landing
 * spot as the strip allows. Request changes opens a field in place: the owner
 * writes what to move, and that sentence goes to the agent with the denial so
 * the next plan answers it.
 */
function Decision({
  canRespond,
  copy,
  name,
  onInputResponses,
  requestId,
}: {
  readonly canRespond: boolean;
  readonly copy: BlueprintCopy;
  readonly name: string;
  readonly onInputResponses: Respond;
  readonly requestId: string | undefined;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState("");
  const [pending, setPending] = useState<"approve" | "deny" | "changes" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = !canRespond || !requestId || pending !== null;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const respond = (kind: "approve" | "deny" | "changes") => {
    if (disabled || !requestId) return;
    setPending(kind);
    if (kind === "approve") {
      void onInputResponses([{ requestId, optionId: "approve" }]);
      return;
    }
    // Eve resumes a denied call in two steps: the model first sees only
    // "Tool execution was denied." (and acknowledges it), then any message
    // sent with the answer. Changes need that second step; a discard does
    // not, and sending one there only buys a second reply saying the same.
    const text = kind === "changes" ? changes.trim() : "";
    void onInputResponses(
      [{ requestId, optionId: "deny", ...(text ? { text } : {}) }],
      text ? t("proposal.changesMessage", { name, changes: text }) : undefined,
    );
  };

  const submitChanges = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changes.trim()) return;
    respond("changes");
  };

  if (editing) {
    return (
      <form className={cn(styles.node, "flex w-full flex-wrap items-center gap-2")} onSubmit={submitChanges}>
        <Input
          aria-label={t("proposal.changesLabel")}
          className="min-w-0 flex-1 basis-56"
          disabled={disabled}
          onChange={(event) => setChanges(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          placeholder={copy.changesPlaceholder}
          ref={inputRef}
          value={changes}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <Button disabled={pending !== null} onClick={() => setEditing(false)} size="sm" type="button" variant="ghost">
            {t("proposal.changesCancel")}
          </Button>
          <Button disabled={disabled || !changes.trim()} size="sm" type="submit">
            {pending === "changes" ? <Spinner className="size-3.5" /> : null}
            {t("proposal.changesSend")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className={cn(styles.node, "flex w-full flex-wrap items-center gap-x-3 gap-y-2")}>
      <p className="min-w-0 flex-1 basis-48 text-pretty">{copy.ready}</p>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label={copy.ready}>
        <Button disabled={disabled} onClick={() => respond("deny")} size="sm" type="button" variant="ghost">
          {pending === "deny" ? <Spinner className="size-3.5" /> : null}
          {t("proposal.discard")}
        </Button>
        <Button disabled={disabled} onClick={() => setEditing(true)} size="sm" type="button" variant="outline">
          {t("proposal.changes")}
        </Button>
        <Button disabled={disabled} onClick={() => respond("approve")} size="sm" type="button">
          {pending === "approve" ? (
            <Spinner className="size-3.5" />
          ) : (
            <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
          )}
          {copy.build}
        </Button>
      </div>
    </div>
  );
}

/** What the build does, ticked off while the tool runs. The last step holds
 *  its spinner until the result arrives, so the list never claims a save
 *  that has not happened. */
function BuildProgress({ steps }: { readonly steps: readonly string[] }) {
  const t = useT();
  const reduce = useReducedMotion();
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (done >= steps.length - 1) return;
    const timer = window.setTimeout(() => setDone((value) => value + 1), reduce ? 0 : BUILD_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [done, reduce, steps.length]);

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={t("proposal.stage.building")}>
      {steps.map((step, index) => (
        <li className="flex items-center gap-1.5" key={step}>
          {index < done ? (
            <HugeiconsIcon
              className="shrink-0 text-emerald-600 dark:text-emerald-400"
              icon={Tick02Icon}
              size={13}
              strokeWidth={2}
            />
          ) : index === done ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-border" />
          )}
          <span className={cn(index > done && "text-muted-foreground/60")}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Pieces the sections are written with ──────────────────────────────

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed text-pretty">
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-foreground">{children}</span>
    </p>
  );
}

export function Prose({ children }: { readonly children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-pretty text-foreground">{children}</p>;
}

export function Quote({ children }: { readonly children: ReactNode }) {
  return (
    <blockquote className="w-fit max-w-full rounded-lg rounded-tl-sm border border-border/70 bg-card px-3 py-1.5 text-[13px] leading-relaxed text-pretty text-foreground shadow-xs">
      “{children}”
    </blockquote>
  );
}
