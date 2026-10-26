"use client";

import type { EveDynamicToolPart } from "eve/react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AiImagineIcon,
  ArrowRight01Icon,
  Blockchain05Icon,
  BubbleChatIcon,
  Call02Icon,
  Cancel01Icon,
  Comment01Icon,
  Mic01Icon,
  ShieldKeyIcon,
  Target01Icon,
  Tick02Icon,
  UserSwitchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { Button } from "@/components/ui/button";
import { CategoryBadge } from "@/components/ui/category-badge";
import { CAPABILITY_HUES } from "@/lib/agent-capabilities";
import { readAgentProposal, readAgentProposalResult, type AgentProposal } from "@/lib/agent-proposal";
import { getAgentTemplate } from "@/lib/agent-templates";
import type { InputAnswer } from "@/lib/chat-input-request";
import { useAppLocale, useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AgentInputResponse } from "../agent-message";
import { ChannelBadge } from "../channel-badge";
import {
  Field,
  ProposalBlueprint,
  proposalStageOf,
  Prose,
  Quote,
  type BlueprintSection,
  type ProposalStage,
} from "./proposal-blueprint";

/**
 * A `propose_agent` call, drawn as a blueprint (./proposal-blueprint.tsx):
 * where the agent works, its role, voice, personality, rules, capabilities
 * and handoff, then Build / Request changes / Discard. Nothing exists until
 * Build; what it builds is a draft in Mis Agentes.
 */
export function AgentProposalCard({
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
  const proposal = readAgentProposal(part.input);
  if (!proposal) return null;
  const stage = proposalStage(part, answer, movedOn);
  const result = stage === "built" ? readAgentProposalResult(part.output) : null;
  const template = getAgentTemplate(proposal.iconKey);
  const speaks = proposal.channels.includes("voice");
  return (
    <ProposalBlueprint
      answer={answer}
      avatar={{ icon: template?.icon ?? AiImagineIcon, className: template?.accent ?? "bg-muted text-foreground" }}
      buildSteps={(["prompt", "capabilities", ...(speaks ? ["voice"] : []), "save"] as const).map((step) =>
        t(`proposal.buildStep.${step}`),
      )}
      builtActions={(openRef) =>
        result ? (
          <>
            {result.voice ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`${result.href}/voice`}>
                  <HugeiconsIcon icon={Mic01Icon} size={14} strokeWidth={1.75} />
                  {t("proposal.setUpVoice")}
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={`${result.href}/chat`}>{t("proposal.try")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={result.href} ref={openRef}>
                {t("proposal.open")}
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
              </Link>
            </Button>
          </>
        ) : null
      }
      canRespond={canRespond}
      copy={{
        kicker: t("proposal.kicker"),
        ready: t("proposal.ready"),
        build: t("proposal.build"),
        changesPlaceholder: t("proposal.changesPlaceholder"),
        failed: t("proposal.failedNote"),
        built: t("proposal.builtTitle", { name: result?.name || proposal.name }),
      }}
      description={proposal.description}
      notes={proposal.notes}
      onInputResponses={onInputResponses}
      part={part}
      sections={proposalSections(proposal, t)}
      sheet={
        proposal.step
          ? t("proposal.sheet", { index: String(proposal.step.index), total: String(proposal.step.total) })
          : undefined
      }
      stage={stage}
      title={proposal.name}
    />
  );
}

/** Whether the chat should draw this tool call as a proposal. */
export function isAgentProposalPart(part: EveDynamicToolPart): boolean {
  return part.toolName === "propose_agent" && readAgentProposal(part.input) !== null;
}

/** Where the proposal stands, from the strongest evidence in the transcript. */
export function proposalStage(
  part: EveDynamicToolPart,
  answer: InputAnswer | undefined,
  movedOn: boolean,
): ProposalStage {
  return proposalStageOf(part, answer, movedOn, (output) => readAgentProposalResult(output) !== null);
}

type SectionId = "channels" | "identity" | "voice" | "personality" | "rules" | "capabilities" | "handoff";

const SECTION_ICONS: Record<SectionId, IconSvgElement> = {
  channels: BubbleChatIcon,
  identity: Target01Icon,
  voice: Call02Icon,
  personality: Comment01Icon,
  rules: ShieldKeyIcon,
  capabilities: Blockchain05Icon,
  handoff: UserSwitchIcon,
};

/** The plan's sections, in the order a conversation meets them. */
function proposalSections(proposal: AgentProposal, t: ReturnType<typeof useT>): BlueprintSection[] {
  const sections: { id: SectionId; body: ReactNode }[] = [
    { id: "channels", body: <ChannelsBody proposal={proposal} /> },
    { id: "identity", body: <IdentityBody proposal={proposal} /> },
  ];
  if (proposal.channels.includes("voice") && proposal.voiceFirstMessage) {
    sections.push({ id: "voice", body: <Quote>{proposal.voiceFirstMessage}</Quote> });
  }
  if (proposal.tone || proposal.greeting || proposal.language !== "auto") {
    sections.push({ id: "personality", body: <PersonalityBody proposal={proposal} /> });
  }
  if (proposal.rules.length > 0 || proposal.avoid.length > 0) {
    sections.push({ id: "rules", body: <RulesBody proposal={proposal} /> });
  }
  sections.push({ id: "capabilities", body: <CapabilitiesBody proposal={proposal} /> });
  if (proposal.handoff) {
    sections.push({ id: "handoff", body: <Prose>{proposal.handoff}</Prose> });
  }
  return sections.map((section) => ({
    ...section,
    icon: SECTION_ICONS[section.id],
    label: t(`proposal.section.${section.id}`),
    drawing: t(`proposal.drawing.${section.id}`),
  }));
}

function ChannelsBody({ proposal }: { readonly proposal: AgentProposal }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {proposal.channels.map((channel) => (
        <ChannelBadge channel={channel} key={channel} />
      ))}
    </div>
  );
}

function IdentityBody({ proposal }: { readonly proposal: AgentProposal }) {
  const t = useT();
  return (
    <div className="grid gap-1.5">
      <p className="text-sm leading-relaxed font-medium text-pretty text-foreground">{proposal.role}</p>
      {proposal.goal ? <Field label={t("proposal.goal")}>{proposal.goal}</Field> : null}
      {proposal.audience ? <Field label={t("proposal.audience")}>{proposal.audience}</Field> : null}
    </div>
  );
}

function PersonalityBody({ proposal }: { readonly proposal: AgentProposal }) {
  const t = useT();
  const { locale } = useAppLocale();
  return (
    <div className="grid gap-1.5">
      {proposal.tone ? <Field label={t("proposal.tone")}>{proposal.tone}</Field> : null}
      <Field label={t("proposal.language")}>
        {proposal.language === "auto" ? t("proposal.languageAuto") : languageName(proposal.language, locale)}
      </Field>
      {proposal.greeting && proposal.channels.some((channel) => channel !== "voice") ? (
        <Quote>{proposal.greeting}</Quote>
      ) : null}
    </div>
  );
}

function RulesBody({ proposal }: { readonly proposal: AgentProposal }) {
  const t = useT();
  return (
    <div className="grid gap-3 @min-[440px]:grid-cols-2">
      {proposal.rules.length > 0 ? (
        <RuleList icon={Tick02Icon} items={proposal.rules} label={t("proposal.section.rules")} tone="do" />
      ) : null}
      {proposal.avoid.length > 0 ? (
        <RuleList icon={Cancel01Icon} items={proposal.avoid} label={t("proposal.section.avoid")} tone="never" />
      ) : null}
    </div>
  );
}

function RuleList({
  icon,
  items,
  label,
  tone,
}: {
  readonly icon: IconSvgElement;
  readonly items: readonly string[];
  readonly label: string;
  readonly tone: "do" | "never";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <ul className="mt-1 grid gap-1">
        {items.map((item, index) => (
          <li className="flex gap-2 text-[13px] leading-relaxed text-pretty text-foreground" key={index}>
            <HugeiconsIcon
              className={cn(
                "mt-[3px] shrink-0",
                tone === "do" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              )}
              icon={icon}
              size={13}
              strokeWidth={2}
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CapabilitiesBody({ proposal }: { readonly proposal: AgentProposal }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {proposal.capabilities.map((capability) => (
        <CategoryBadge hue={CAPABILITY_HUES[capability]} key={capability} size="sm">
          {t(`capability.${capability}`)}
        </CategoryBadge>
      ))}
    </div>
  );
}

function languageName(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}
