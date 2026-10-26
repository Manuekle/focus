"use client";

import type { EveDynamicToolPart } from "eve/react";
import Link from "next/link";
import { type ReactNode, type RefObject, useMemo, useState } from "react";
import {
  ArrowRight01Icon,
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  FlowIcon,
  ToggleOnIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import { CategoryBadge } from "@/components/ui/category-badge";
import {
  countProposalSteps,
  readAutomationProposal,
  readAutomationProposalResult,
  readDuration,
  readKeywords,
  type AutomationProposal,
  type AutomationProposalStep,
} from "@/lib/automation-proposal";
import type { InputAnswer } from "@/lib/chat-input-request";
import { useAppLocale, useT } from "@/lib/i18n/provider";
import { STEP_HUES, STEP_ICONS, STEP_LABEL_KEYS } from "@/lib/workflow-step-meta";
import { durationText, scheduleSentence, stepText, TRIGGER_ICONS, TRIGGER_LABELS } from "./automation-text";
import { AutomationDiagram, automationDiagramStepAt, automationDiagramSteps } from "./automation-diagram";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson, uiErrorMessage } from "@/lib/api-error-message";
import type { AgentInputResponse } from "../agent-message";
import { ChannelBadge } from "../channel-badge";
import {
  ProposalBlueprint,
  proposalStageOf,
  Prose,
  Quote,
  type BlueprintSection,
  type ProposalStage,
} from "./proposal-blueprint";

/**
 * A `propose_automation` call, drawn as a blueprint (./proposal-blueprint.tsx):
 * what fires it, where, and the steps in order — condition branches drawn as
 * a fork — then Build / Request changes / Discard. Nothing is saved until
 * Build, and what it saves is an inactive draft the owner switches on from
 * the card or Automations.
 */
export function AutomationProposalCard({
  answer,
  canRespond,
  movedOn,
  onInputResponses,
  part,
}: {
  readonly answer: InputAnswer | undefined;
  readonly canRespond: boolean;
  readonly movedOn: boolean;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
    message?: string,
  ) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const t = useT();
  // Memoized on the call's arguments: the diagram lays the flow out from it.
  const proposal = useMemo(() => readAutomationProposal(part.input), [part.input]);
  if (!proposal) return null;
  const stage = automationProposalStage(part, answer, movedOn);
  const result = stage === "built" ? readAutomationProposalResult(part.output) : null;
  return (
    <ProposalBlueprint
      answer={answer}
      avatar={{ icon: ZapIcon, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" }}
      buildSteps={(["trigger", "steps", "save"] as const).map((step) => t(`proposal.automation.buildStep.${step}`))}
      builtActions={(openRef) =>
        result ? <BuiltActions id={result.id} href={result.href} openRef={openRef} /> : null
      }
      canRespond={canRespond}
      copy={{
        kicker: t("proposal.automation.kicker"),
        ready: t("proposal.automation.ready"),
        build: t("proposal.automation.build"),
        changesPlaceholder: t("proposal.automation.changesPlaceholder"),
        failed: t("proposal.automation.failedNote"),
        built: t("proposal.automation.builtTitle", { name: result?.name || proposal.name }),
      }}
      description={proposal.description}
      diagram={{
        steps: automationDiagramSteps(proposal),
        drawing: (index) => {
          const step = automationDiagramStepAt(proposal, index);
          return step
            ? t("proposal.automation.drawingStep", { step: t(STEP_LABEL_KEYS[step.type]) })
            : t("proposal.automation.drawing.trigger");
        },
        render: (shown) => <AutomationDiagram proposal={proposal} shown={shown} />,
      }}
      onInputResponses={onInputResponses}
      part={part}
      sections={automationSections(proposal, t)}
      stage={stage}
      title={proposal.name}
    />
  );
}

/**
 * What comes after Build, in the card itself: switch it on, or open it.
 *
 * The draft is off until a person turns it on — that rule stands, because an
 * automation writes to real customers. What changed is where: the owner who
 * just read the diagram and built it can switch it on right here instead of
 * hunting for it in Automatizaciones. The API still refuses a flow with
 * template blanks left in it, and says so.
 */
function BuiltActions({
  href,
  id,
  openRef,
}: {
  readonly href: string;
  readonly id: string;
  readonly openRef: RefObject<HTMLAnchorElement | null>;
}) {
  const t = useT();
  const [state, setState] = useState<"idle" | "saving" | "active">("idle");
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setState("saving");
    setError(null);
    const result = await fetchJson<{ automations: { id: string; status: string }[] }>("/api/automations", t, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: "active" }),
    });
    if (result.ok && Array.isArray(result.data?.automations) && result.data.automations.some((automation) => automation.id === id && automation.status === "active")) {
      setState("active");
      return;
    }
    setState("idle");
    setError(result.ok ? t("apiError.not_found") : uiErrorMessage(t, result.error));
  };

  return (
    <>
      {error ? <span className="w-full text-[12px] text-destructive" role="alert">{error}</span> : null}
      {state === "active" ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400" role="status">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} />
          {t("proposal.automation.active")}
        </span>
      ) : (
        <Button disabled={state === "saving"} onClick={() => void activate()} size="sm" type="button" variant="outline">
          {state === "saving" ? (
            <Spinner className="size-3.5" />
          ) : (
            <HugeiconsIcon icon={ToggleOnIcon} size={14} strokeWidth={1.75} />
          )}
          {t("proposal.automation.activate")}
        </Button>
      )}
      <Button asChild size="sm">
        <Link href={href} ref={openRef}>
          {t("proposal.automation.open")}
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
        </Link>
      </Button>
    </>
  );
}

/**
 * Whether the chat should draw this tool call as a proposal.
 *
 * Before the tool asked for approval it saved the draft straight away, and
 * those calls are still in old conversations: one that ran without ever being
 * put to the owner keeps the plain disclosure rather than a card saying they
 * approved it.
 */
export function isAutomationProposalPart(part: EveDynamicToolPart): boolean {
  if (part.toolName !== "propose_automation" || readAutomationProposal(part.input) === null) return false;
  const ran = part.state === "output-available" || part.state === "output-error";
  return !ran || part.approval !== undefined || part.toolMetadata?.eve?.inputRequest !== undefined;
}

/** Where the proposal stands, from the strongest evidence in the transcript. */
export function automationProposalStage(
  part: EveDynamicToolPart,
  answer: InputAnswer | undefined,
  movedOn: boolean,
): ProposalStage {
  return proposalStageOf(part, answer, movedOn, (output) => readAutomationProposalResult(output) !== null);
}

type SectionId = "trigger" | "channel" | "steps";

/** The plan's sections, in the order the automation runs. */
function automationSections(proposal: AutomationProposal, t: ReturnType<typeof useT>): BlueprintSection[] {
  const sections: { id: SectionId; icon: IconSvgElement; body: ReactNode }[] = [
    { id: "trigger", icon: TRIGGER_ICONS[proposal.trigger], body: <TriggerBody proposal={proposal} /> },
    { id: "channel", icon: BubbleChatIcon, body: <ChannelBody proposal={proposal} /> },
    {
      id: "steps",
      icon: FlowIcon,
      body:
        proposal.steps.length > 0 ? (
          <StepList steps={proposal.steps} />
        ) : (
          <Prose>{t("proposal.automation.noSteps")}</Prose>
        ),
    },
  ];
  const count = countProposalSteps(proposal.steps);
  return sections.map((section) => ({
    ...section,
    label:
      section.id === "steps" && count > 0
        ? `${t("proposal.automation.section.steps")} · ${count}`
        : t(`proposal.automation.section.${section.id}`),
    drawing: t(`proposal.automation.drawing.${section.id}`),
  }));
}

function TriggerBody({ proposal }: { readonly proposal: AutomationProposal }) {
  const t = useT();
  return (
    <div className="grid gap-1.5">
      <CategoryBadge size="sm">
        <HugeiconsIcon aria-hidden="true" icon={TRIGGER_ICONS[proposal.trigger]} size={12} strokeWidth={1.75} />
        {t(TRIGGER_LABELS[proposal.trigger])}
      </CategoryBadge>
      <TriggerDetail proposal={proposal} />
    </div>
  );
}

function TriggerDetail({ proposal }: { readonly proposal: AutomationProposal }) {
  const t = useT();
  const { locale } = useAppLocale();
  switch (proposal.trigger) {
    case "keyword": {
      const words = readKeywords(proposal.triggerValue);
      return (
        <div className="grid gap-1.5">
          <Prose>{t("proposal.automation.trigger.keyword")}</Prose>
          {words.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {words.map((word) => (
                <li
                  className="rounded-md border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[12px] leading-4 text-foreground"
                  key={word}
                >
                  {word}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    case "schedule":
      return <ScheduleDetail cron={proposal.triggerValue} locale={locale} />;
    case "no_reply": {
      const duration = readDuration(proposal.triggerValue);
      const wait = duration ? durationText(duration, locale) : proposal.triggerValue;
      return <Prose>{wait ? t("proposal.automation.trigger.no_reply", { duration: wait }) : t("automations.triggerNoReplyDesc")}</Prose>;
    }
    case "new_chat":
      return <Prose>{t("proposal.automation.trigger.new_chat")}</Prose>;
    case "webhook":
      return (
        <div className="grid gap-1">
          <Prose>{t("proposal.automation.trigger.webhook")}</Prose>
          <p className="text-[12px] leading-relaxed text-pretty text-muted-foreground">
            {t("proposal.automation.trigger.webhookSecret")}
          </p>
        </div>
      );
  }
}

/**
 * The schedule in words, on the business's clock. The model writes the cron in
 * local time and the build converts it to UTC (lib/automation-schedule.ts), so
 * what is drawn here is what the owner asked for, not what gets stored.
 */
function ScheduleDetail({ cron, locale }: { readonly cron: string; readonly locale: string }) {
  const t = useT();
  const sentence = scheduleSentence(cron, locale, t);
  if (!sentence) {
    return (
      <div className="grid gap-1">
        <code className="w-fit rounded-md border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[12px] text-foreground">
          {cron.trim() || "—"}
        </code>
        <p className="text-[12px] text-muted-foreground">{t("proposal.automation.schedule.custom")}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-0.5">
      <p className="text-sm leading-relaxed font-medium text-pretty text-foreground">{sentence}</p>
      <p className="text-[12px] text-muted-foreground">{t("proposal.automation.schedule.local")}</p>
    </div>
  );
}

function ChannelBody({ proposal }: { readonly proposal: AutomationProposal }) {
  const t = useT();
  if (proposal.channel === "all") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <ChannelBadge channel="web" />
        <ChannelBadge channel="whatsapp" />
        <ChannelBadge channel="instagram" />
        <span className="text-[12px] text-muted-foreground">{t("automations.channelAll")}</span>
      </div>
    );
  }
  return <ChannelBadge channel={proposal.channel} />;
}

/**
 * The steps in the order they run. A condition forks: what runs when it holds,
 * and what runs when it does not, each a list of its own under the question.
 */
function StepList({ steps }: { readonly steps: readonly AutomationProposalStep[] }) {
  return (
    <ol className="grid gap-2.5">
      {steps.map((step, index) => (
        <li className="flex min-w-0 gap-2.5" key={index}>
          <span
            aria-hidden="true"
            className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border border-border bg-card font-mono text-[9px] text-muted-foreground tabular-nums"
          >
            {index + 1}
          </span>
          <StepItem step={step} />
        </li>
      ))}
    </ol>
  );
}

function StepItem({ step }: { readonly step: AutomationProposalStep }) {
  const t = useT();
  const { locale } = useAppLocale();
  const preview = stepText(step, locale);
  return (
    <div className="grid min-w-0 flex-1 gap-1">
      <CategoryBadge hue={STEP_HUES[step.type]} size="sm">
        <HugeiconsIcon aria-hidden="true" icon={STEP_ICONS[step.type]} size={12} strokeWidth={1.75} />
        {t(STEP_LABEL_KEYS[step.type])}
      </CategoryBadge>
      {preview ? (
        step.type === "message" || step.type === "transfer_human" ? (
          <Quote>{preview}</Quote>
        ) : (
          <p className="line-clamp-3 text-[13px] leading-relaxed text-pretty break-words text-muted-foreground">
            {preview}
          </p>
        )
      ) : null}
      {step.type === "condition" ? (
        <div className="mt-1 grid gap-2 border-l border-dashed border-border pl-3">
          <Branch label={t("proposal.automation.branchThen")} steps={step.thenSteps} tone="then" />
          <Branch label={t("proposal.automation.branchElse")} steps={step.elseSteps} tone="else" />
        </div>
      ) : null}
    </div>
  );
}

function Branch({
  label,
  steps,
  tone,
}: {
  readonly label: string;
  readonly steps: readonly AutomationProposalStep[];
  readonly tone: "then" | "else";
}) {
  const t = useT();
  return (
    <div className="grid gap-1.5">
      <p
        className={
          tone === "then"
            ? "text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
            : "text-[11px] font-medium text-muted-foreground"
        }
      >
        {label}
      </p>
      {steps.length > 0 ? (
        <StepList steps={steps} />
      ) : (
        <p className="text-[12px] text-muted-foreground">{t("proposal.automation.branchEmpty")}</p>
      )}
    </div>
  );
}
