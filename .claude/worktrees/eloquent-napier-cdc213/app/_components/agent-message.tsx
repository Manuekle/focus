"use client";

import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ExternalLinkIcon, File01Icon } from "@hugeicons/core-free-icons";
import { memo } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { MessageResponse } from "@/components/ai-elements/message-response";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "@/components/agents/tool-result";
import { isArtifactPart, ToolArtifact } from "./chat/artifacts";
import { AgentProposalCard, isAgentProposalPart } from "./chat/agent-proposal-card";
import { AutomationProposalCard, isAutomationProposalPart } from "./chat/automation-proposal-card";
import { InputRequestCard } from "./chat/input-request-card";
import { Orb } from "@/components/ui/orb";
import { Button } from "@/components/ui/button";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";
import { conversationMovedOn } from "@/lib/chat-input-request";
import type { SessionAnswers } from "@/lib/chat-input-answers";
import { useT } from "@/lib/i18n/provider";
import { chatPayment, PaymentMessageScope, PaymentMessageLink, PaymentToolResult } from "@/components/agents/payment-tool-result";

const messageComponents = { a: PaymentMessageLink };

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

export const AgentMessage = memo(function AgentMessage({
  answers,
  canRespond,
  isLast,
  isStreaming,
  message,
  onInputResponses,
}: {
  /** Answers given on this device to the agent's questions, by request id. */
  readonly answers: SessionAnswers;
  readonly canRespond: boolean;
  /** Whether this is the newest message — a question in an older one is settled. */
  readonly isLast: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  /** `message` rides along as the owner's next line in the same request — how
   *  "request changes" on a proposal says what to change. */
  readonly onInputResponses: (responses: readonly AgentInputResponse[], message?: string) => void | Promise<void>;
}) {
  const t = useT();
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const hasText = lastTextIndex >= 0;

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <PaymentMessageScope parts={message.parts}>
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            answers={answers}
            canRespond={canRespond}
            isLast={isLast}
            key={partKey(part, index)}
            message={message}
            onInputResponses={onInputResponses}
            part={part}
            showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
          />
        ))}
        {/* Active composing indicator — shown when the assistant is
            streaming but hasn't emitted text content yet. */}
        {isStreaming && message.role === "assistant" && !hasText ? (
          <div className="flex items-center gap-2.5 py-1 pl-1 text-muted-foreground">
            <Orb state="composing" />
            <span className="text-xs">{t("chat.composing")}</span>
          </div>
        ) : null}
      </MessageContent>
      </PaymentMessageScope>
    </Message>
  );
});

function AgentMessagePart({
  answers,
  canRespond,
  isLast,
  message,
  onInputResponses,
  part,
  showCaret,
}: {
  readonly answers: SessionAnswers;
  readonly canRespond: boolean;
  readonly isLast: boolean;
  readonly message: EveMessage;
  /** `message` rides along as the owner's next line in the same request — how
   *  "request changes" on a proposal says what to change. */
  readonly onInputResponses: (responses: readonly AgentInputResponse[], message?: string) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  const t = useT();
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret} components={message.parts.some((part) => Boolean(chatPayment(part))) ? messageComponents : undefined}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file": {
      const label = part.filename ?? t("chat.attachment");
      const isImage =
        part.mediaType?.startsWith("image/") ||
        part.url?.startsWith("data:image/") ||
        /\.(png|jpe?g|webp|gif|svg)$/i.test(label);

      // An attachment is a card like everything else the transcript holds —
      // the same frame at the compact size, with the filename in the gap
      // instead of floating loose under the picture.
      if (isImage && part.url) {
        return (
          <FramedCard className="my-1.5 max-w-sm" size="compact">
            <FramedCardPanel className="group relative bg-card" size="compact">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={part.url}
                alt={label}
                className="max-h-72 w-full object-contain"
                loading="lazy"
              />
              <a
                href={part.url}
                target="_blank"
                rel="noreferrer"
                className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-white text-xs font-medium gap-1.5"
              >
                <span>Ver imagen completa</span>
                <HugeiconsIcon icon={ExternalLinkIcon} size={14} strokeWidth={2} />
              </a>
            </FramedCardPanel>
            {part.filename ? (
              <FramedCardFooter size="compact">
                <span className="min-w-0 truncate">{part.filename}</span>
              </FramedCardFooter>
            ) : null}
          </FramedCard>
        );
      }

      return (
        <FramedCard className="my-1.5 max-w-sm" size="compact">
          <FramedCardPanel className="flex items-center gap-2.5 px-3 py-2.5 text-sm" size="compact">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={File01Icon} size={16} strokeWidth={1.75} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {part.url ? (
                <a
                  className="truncate font-medium text-foreground hover:underline inline-flex items-center gap-1"
                  href={part.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="truncate">{label}</span>
                  <HugeiconsIcon className="shrink-0" icon={ExternalLinkIcon} size={12} strokeWidth={1.75} />
                </a>
              ) : (
                <span className="truncate font-medium">{label}</span>
              )}
              <span className="text-[10px] text-muted-foreground">{part.mediaType || "Archivo"}</span>
            </div>
          </FramedCardPanel>
        </FramedCard>
      );
    }
    case "authorization":
      return (
        <FramedCard className="my-1.5">
          <FramedCardPanel className="space-y-2 p-4 text-sm">
            <p className="font-medium">{part.displayName}</p>
            <p className="text-muted-foreground">{part.description}</p>
            {part.state === "required" ? (
              <>
                {part.authorization?.instructions ? <p>{part.authorization.instructions}</p> : null}
                {part.authorization?.userCode ? (
                  <code className="block w-fit rounded border border-border/50 bg-muted px-2 py-1">
                    {part.authorization.userCode}
                  </code>
                ) : null}
                {part.authorization?.url ? (
                  <Button asChild size="sm">
                    <a href={part.authorization.url} rel="noreferrer" target="_blank">
                      {t("chat.signIn")}
                      <HugeiconsIcon icon={ExternalLinkIcon} size={16} strokeWidth={1.75} />
                    </a>
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">
                {part.outcome === "authorized"
                  ? t("chat.authorizationComplete")
                  : t("chat.authorizationStatus", { status: part.outcome })}
              </p>
            )}
          </FramedCardPanel>
        </FramedCard>
      );
    case "dynamic-tool": {
      // Two tools are not disclosures at all: `chart` and `report` exist to put
      // something on screen, so their payload replaces the terminal block
      // rather than hiding inside it. See ./chat/artifacts.
      if (isArtifactPart(part)) {
        return <ToolArtifact part={part} />;
      }

      const label = part.toolName === "send_payment_link" ? t("payment.title") : toolLabel(part);
      const inputRequest = part.toolMetadata?.eve?.inputRequest;

      // A proposed agent or automation is the plan itself, not an approval
      // over a JSON payload: the owner reads it as a blueprint and decides on
      // it there.
      const Proposal = isAgentProposalPart(part)
        ? AgentProposalCard
        : isAutomationProposalPart(part)
          ? AutomationProposalCard
          : null;
      if (Proposal) {
        return (
          <Proposal
            answer={
              part.toolMetadata?.eve?.inputResponse ?? (inputRequest ? answers[inputRequest.requestId] : undefined)
            }
            canRespond={canRespond}
            movedOn={conversationMovedOn(message, isLast, part)}
            onInputResponses={onInputResponses}
            part={part}
          />
        );
      }

      // A question or an approval is a card, not a disclosure: it is waiting
      // on a person, and a spinner labelled "Ejecutando" tells them nothing.
      // An approval that went on to run still shows what it produced below.
      if (inputRequest) {
        const card = (
          <InputRequestCard
            answer={part.toolMetadata?.eve?.inputResponse ?? answers[inputRequest.requestId]}
            canRespond={canRespond}
            movedOn={conversationMovedOn(message, isLast, part)}
            onInputResponses={onInputResponses}
            part={part}
            toolLabel={label}
          />
        );
        const ran = part.state === "output-available" || part.state === "output-error";
        if (!ran || part.toolName === "ask_question") return card;
        if (part.toolName === "send_payment_link") return <div className="space-y-1">{card}<PaymentToolResult part={part} /></div>;
        const ranOutput = part.errorText ?? formatToolOutput(part.output);
        return (
          <div className="space-y-1">
            {card}
            <ToolResult
              tool={label}
              title={t(TOOL_STATE_KEYS[part.state] ?? "chat.toolRunning")}
              status={toolResultStatus(part.state)}
              kind="terminal"
              defaultOpen={false}
              copyText={ranOutput || undefined}
            >
              {ranOutput ? <ToolResultOutput language="json">{ranOutput}</ToolResultOutput> : null}
            </ToolResult>
          </div>
        );
      }

      if (part.toolName === "send_payment_link") return <PaymentToolResult part={part} />;

      // Everything else is an execution disclosure: name, status, and the
      // payload it produced, collapsed once it finishes so a long run doesn't
      // bury the answer.
      const output = part.errorText ?? formatToolOutput(part.output);
      return (
        <ToolResult
          tool={label}
          title={t(TOOL_STATE_KEYS[part.state] ?? "chat.toolRunning")}
          status={toolResultStatus(part.state)}
          kind="terminal"
          defaultOpen={false}
          collapseOnComplete
          copyText={output || undefined}
        >
          {output ? <ToolResultOutput language="json">{output}</ToolResultOutput> : null}
        </ToolResult>
      );
    }
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

/** Map the Eve/AI-SDK part state onto the four states the disclosure renders. */
function toolResultStatus(state: EveDynamicToolPart["state"]): ToolResultStatus {
  switch (state) {
    case "output-error":
      return "error";
    case "output-available":
      return "success";
    case "output-denied":
      return "cancelled";
    default:
      return "running";
  }
}

const TOOL_STATE_KEYS: Partial<Record<EveDynamicToolPart["state"], string>> = {
  "approval-requested": "chat.toolAwaitingApproval",
  "approval-responded": "chat.toolApprovalSent",
  "input-streaming": "chat.toolPending",
  "input-available": "chat.toolRunning",
  "output-available": "chat.toolCompleted",
  "output-error": "chat.toolFailed",
  "output-denied": "chat.toolDenied",
};

/**
 * What the disclosure names the call. Eve prefixes framework actions
 * (`eve:load-skill`, `eve:subagent:analista`) and the bare prefix means nothing
 * to the person reading; the skill or specialist's own name does.
 */
function toolLabel(part: EveDynamicToolPart): string {
  const eve = part.toolMetadata?.eve;
  if (eve?.kind === "load-skill" || part.toolName === "eve:load-skill") {
    const name = isRecord(part.input) && typeof part.input.name === "string" ? part.input.name : undefined;
    return name ? `load_skill · ${name}` : "load_skill";
  }
  if (eve?.kind === "subagent-call" || part.toolName.startsWith("eve:subagent:")) {
    return eve?.name ?? part.toolName.slice("eve:subagent:".length);
  }
  return part.toolName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Tool payloads arrive as objects far more often than strings. */
function formatToolOutput(output: unknown): string {
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `${part.type}:${part.turnId}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
