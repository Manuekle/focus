"use client";

import type { EveDynamicToolPart } from "eve/react";
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  HelpCircleIcon,
  Loading03Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { type FormEvent, useId, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ActionSwapRollIcon, ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  answerLabel,
  approvalOutcome,
  inputRequestPhase,
  isApprovalRequest,
  type InputAnswer,
  type InputRequestPhase,
} from "@/lib/chat-input-request";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AgentInputResponse } from "../agent-message";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";

/**
 * A question or an approval the agent is waiting on, drawn as a card instead
 * of a terminal disclosure.
 *
 * The disclosure said "Esperando aprobación · ask_question · Ejecutando" for a
 * plain question, kept spinning after it was answered, and came back with live
 * buttons after a reload — see lib/chat-input-request.ts for why. This card
 * shows the phase the transcript actually proves, and once a question is
 * settled it shrinks to what was asked and what was chosen.
 *
 * ## The layout
 *
 * The frame is the console's own (see components/ui/framed-card): an inset panel holding the
 * question, and the gap below it holding where the answer stands. What changed
 * with it is the options. They used to be a wrapped row of pill buttons, which
 * turns "Auditoría completa (técnica + contenido + keywords)" and "Solo la
 * home" into two shapes of wildly different width on two ragged lines — a
 * layout that reads as a toolbar when it is in fact a list of answers, and one
 * with nowhere to put an option's `description`. They are a stacked list now:
 * one row each, full width, the label and its description together, a target
 * over 44px, and the same order the keyboard walks.
 *
 * Approvals keep the two-button row. Approve and Deny are a single decision
 * with two ends, not a list to read down, and setting them side by side is
 * what keeps the destructive one from being the thing your thumb lands on.
 */
export function InputRequestCard({
  answer,
  canRespond,
  movedOn,
  onInputResponses,
  part,
  toolLabel,
}: {
  readonly answer: InputAnswer | undefined;
  readonly canRespond: boolean;
  readonly movedOn: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
  readonly toolLabel: string;
}) {
  const t = useT();
  const promptId = useId();
  const [text, setText] = useState("");
  const request = part.toolMetadata?.eve?.inputRequest;
  if (!request) return null;

  const approval = isApprovalRequest(request.options);
  const phase = inputRequestPhase({ state: part.state, answer, movedOn });
  const live = phase === "pending";
  const acceptsText = !approval && (request.allowFreeform || !request.options?.length);
  const chosenId = answer?.optionId;
  const disabled = !live || !canRespond;

  const respond = (response: Omit<AgentInputResponse, "requestId">) => {
    if (disabled) return;
    void onInputResponses([{ requestId: request.requestId, ...response }]);
  };

  const handleText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    respond({ text: value });
  };

  const outcome = approval ? approvalOutcome(part, answer) : undefined;
  const chosen = approval ? undefined : answerLabel(request.options, answer);
  const settled = phase === "answered" || phase === "closed";

  const footer = settled ? (
    chosen && !approval ? (
      <p className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          className="shrink-0 text-emerald-600 dark:text-emerald-400"
          icon={CheckmarkCircle02Icon}
          size={14}
          strokeWidth={1.75}
        />
        <span>{t("chat.inputYouChose")}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{chosen}</span>
      </p>
    ) : phase === "closed" ? (
      <p>{t("chat.inputClosedNote")}</p>
    ) : null
  ) : approval ? null : (
    // Kept through `sending` as well as `pending`. Tying it to `live` alone
    // unmounted the strip the instant an option was clicked, so the card lost
    // a row of height in the same frame the spinner appeared — the answer
    // looked like it had already been dealt with. The composer is still there
    // to type into while the answer is in flight, so the line is still true.
    <p>{t("chat.inputTypeHint")}</p>
  );

  return (
    <FramedCard
      aria-labelledby={promptId}
      as="section"
      className="my-1.5"
      data-phase={phase}
      tone={settled ? "quiet" : "default"}
    >
      <FramedCardPanel className="p-4" tone={settled ? "quiet" : "default"}>
        <header className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]"
          >
            <HugeiconsIcon icon={approval ? ShieldKeyIcon : HelpCircleIcon} size={16} strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 truncate font-medium text-muted-foreground">
                {approval ? t("chat.inputApprovalTitle") : t("chat.inputQuestionTitle")}
              </span>
              <PhaseBadge outcome={outcome} phase={phase} />
            </div>
            <p
              className={cn(
                "text-pretty leading-relaxed",
                settled ? "text-sm text-muted-foreground" : "text-[15px] text-foreground",
              )}
              id={promptId}
            >
              {request.prompt}
            </p>
          </div>
        </header>

        {approval ? <ApprovalDetails input={part.input} settled={settled} toolLabel={toolLabel} /> : null}

        {settled ? null : (
          <>
            {request.options?.length ? (
              approval ? (
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-labelledby={promptId}>
                  {request.options.map((option) => (
                    <Button
                      aria-pressed={chosenId === option.id}
                      className="min-w-24"
                      disabled={disabled}
                      key={option.id}
                      onClick={() => respond({ optionId: option.id })}
                      size="sm"
                      title={option.description}
                      type="button"
                      variant={option.id === "approve" ? "default" : "outline"}
                    >
                      {/* The spinner takes the label's own cell instead of
                          being pushed in beside it: inserting an icon into a
                          button mid-press slides the word sideways under the
                          pointer that just hit it. */}
                      <span
                        className="t-icon-swap"
                        data-state={phase === "sending" && chosenId === option.id ? "b" : "a"}
                      >
                        <span className="t-icon" data-icon="a">
                          {option.id === "approve" ? t("chat.inputApprove") : t("chat.inputDeny")}
                        </span>
                        <span className="t-icon" data-icon="b">
                          <HugeiconsIcon
                            className="motion-safe:animate-spin"
                            icon={Loading03Icon}
                            size={14}
                            strokeWidth={2}
                          />
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <ul aria-labelledby={promptId} className="mt-3 grid gap-1.5">
                  {request.options.map((option) => (
                    <li key={option.id}>
                      <OptionRow
                        disabled={disabled}
                        onSelect={() => respond({ optionId: option.id })}
                        option={option}
                        selected={chosenId === option.id}
                        sending={phase === "sending" && chosenId === option.id}
                      />
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {acceptsText ? (
              <form className="mt-2.5 flex gap-2" onSubmit={handleText}>
                <Input
                  aria-label={t("chat.responseLabel")}
                  className="min-w-0 flex-1"
                  disabled={disabled}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={t("chat.typeResponse")}
                  value={phase === "sending" && answer?.text ? answer.text : text}
                />
                <Button disabled={disabled || !text.trim()} type="submit" variant="secondary">
                  {t("chat.send")}
                </Button>
              </form>
            ) : null}
          </>
        )}
      </FramedCardPanel>

      {/* Rendered only when it has something to say: an empty strip is a band
          of dead space under the panel, which is what a card in the sending
          phase would otherwise carry. */}
      {footer ? <FramedCardFooter>{footer}</FramedCardFooter> : null}
    </FramedCard>
  );
}

/**
 * One answer, as a row.
 *
 * The arrow is the row's only decoration and it sits at 40% until the row is
 * hovered or focused: on a card that may hold five of these, five arrows at
 * full strength are five things to look past on the way to the labels. It
 * brightens rather than appearing, because the slot it lives in is also where
 * the spinner goes once the answer is in flight.
 */
function OptionRow({
  disabled,
  onSelect,
  option,
  selected,
  sending,
}: {
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly option: { readonly description?: string; readonly id: string; readonly label: string; readonly style?: string };
  readonly selected: boolean;
  readonly sending: boolean;
}) {
  const danger = option.style === "danger";
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "group flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-left",
        // `opacity` is in the list on purpose — the same reason the Button
        // variants list it. Answering disables every row at once, and without
        // it the dim to 45% lands in one frame and reads as a flicker rather
        // than as the card going quiet.
        "transition-[background-color,border-color,color,opacity] duration-150",
        "outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--btn-focus-ring)]",
        "disabled:pointer-events-none disabled:opacity-45",
        danger
          ? "border-destructive/30 bg-destructive/5 hover:border-destructive/50 hover:bg-destructive/10"
          : option.style === "primary"
            ? "border-foreground/25 bg-muted/60 hover:border-foreground/40 hover:bg-muted"
            : "border-border/60 bg-muted/40 hover:border-input hover:bg-muted/70",
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm leading-snug text-pretty",
            danger ? "text-destructive" : "text-foreground",
            option.style === "primary" && "font-medium",
          )}
        >
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground text-pretty">
            {option.description}
          </span>
        ) : null}
      </span>
      {/* One slot, two icons. The spinner used to be inserted at the head of
          the row while the answer was in flight, which pushed the label
          sideways at the exact moment the reader was watching it — the arrow
          and the spinner cross-fade in place instead. */}
      <span
        aria-hidden="true"
        className="t-icon-swap shrink-0 text-muted-foreground"
        data-state={sending ? "b" : "a"}
      >
        <span className="t-icon" data-icon="a">
          <HugeiconsIcon
            className="text-muted-foreground/40 transition-colors duration-150 group-hover:text-muted-foreground group-focus-visible:text-muted-foreground"
            icon={ArrowRight01Icon}
            size={15}
            strokeWidth={1.75}
          />
        </span>
        <span className="t-icon" data-icon="b">
          <HugeiconsIcon
            className="motion-safe:animate-spin"
            icon={Loading03Icon}
            size={15}
            strokeWidth={2}
          />
        </span>
      </span>
    </button>
  );
}

/**
 * Where the request stands, in the one place it is read.
 *
 * It used to be four early returns, so every step of the sequence — waiting,
 * sending, answered — replaced the whole badge in a single frame: the colour,
 * the icon and the words all changed at once, next to a `ToolResult` whose
 * own status rolls. The badge is one element now, and the two things that
 * change swap through the same components that row uses: the icon
 * cross-fades, the label rolls, and the colour is a plain tween under both.
 */
function PhaseBadge({
  outcome,
  phase,
}: {
  readonly outcome: "approved" | "denied" | undefined;
  readonly phase: InputRequestPhase;
}) {
  const t = useT();
  const denied = outcome === "denied";
  const key = phase === "answered" ? `${phase}-${outcome ?? "plain"}` : phase;

  const label =
    phase === "pending"
      ? t("chat.inputPending")
      : phase === "sending"
        ? t("chat.inputSending")
        : phase === "answered"
          ? denied
            ? t("chat.inputDenied")
            : outcome === "approved"
              ? t("chat.inputApproved")
              : t("chat.inputAnswered")
          : t("chat.inputClosed");

  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center whitespace-nowrap gap-1.5 font-medium",
        "transition-colors duration-200 ease-out motion-reduce:transition-none",
        phase === "pending"
          ? "text-amber-600 dark:text-amber-400"
          : phase === "sending"
            ? "text-blue-600 dark:text-blue-400"
            : phase === "closed"
              ? "text-muted-foreground"
              : denied
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {phase === "closed" ? null : (
        <ActionSwapRollIcon value={key}>
          {phase === "pending" ? (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full rounded-full bg-current opacity-40 motion-safe:animate-ping" />
              <span className="relative inline-flex size-1.5 rounded-full bg-current" />
            </span>
          ) : phase === "sending" ? (
            <HugeiconsIcon className="motion-safe:animate-spin" icon={Loading03Icon} size={12} strokeWidth={2} />
          ) : (
            <HugeiconsIcon icon={denied ? CancelCircleIcon : CheckmarkCircle02Icon} size={12} strokeWidth={2} />
          )}
        </ActionSwapRollIcon>
      )}
      <ActionSwapRollText value={key}>{label}</ActionSwapRollText>
    </span>
  );
}

function ApprovalDetails({
  input,
  settled,
  toolLabel,
}: {
  readonly input: unknown;
  readonly settled: boolean;
  readonly toolLabel: string;
}) {
  const t = useT();
  const json = formatInput(input);
  return (
    <details className="group mt-3 text-xs" open={!settled && json.length < 240}>
      <summary className="inline-flex min-h-8 cursor-pointer select-none items-center gap-1.5 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
        {t("chat.inputToolDetails")} · <span className="font-mono">{toolLabel}</span>
      </summary>
      {json ? (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/60 p-3 font-mono text-[11px] text-foreground/80">
          {json}
        </pre>
      ) : null}
    </details>
  );
}

function formatInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
