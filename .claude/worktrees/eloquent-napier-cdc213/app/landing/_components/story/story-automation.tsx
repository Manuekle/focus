"use client";

/**
 * The follow-up story: an automation runs, step by step, beside the
 * conversation it is running on.
 *
 *   1  Lucía asks on Instagram whether they ship to Rosario,
 *   2  the AI step answers from Knowledge — with the file it read —
 *   3  the condition sees an answer was found and takes the "resolve" branch,
 *   4  the flow waits a day; she has not written back,
 *   5  so it follows up, and she answers: she wants the payment link.
 *
 * Each step lights as the run reaches it, and its effect lands in the
 * conversation at the same moment, so the flow reads as the cause of what
 * the customer sees.
 */

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  AiElementsIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  GitBranchIcon,
  Message01Icon,
  SentIcon,
  WorkflowSquare10Icon,
} from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { BOARDS } from "./boards";
import {
  Arrive,
  Avatar,
  Bubble,
  Pill,
  Progress,
  SourceChip,
  StoryCanvas,
  type StoryProps,
  type StoryScript,
  Surface,
  Thread,
  Typing,
  useHeight,
  Words,
} from "./kit";
import { ease, fade, mix, ramp, streamedUntil } from "./time";

/** When each step starts and finishes. */
const STEPS = [
  { from: 700, to: 1250 },
  { from: 1350, to: 3500 },
  { from: 3650, to: 4350 },
  { from: 4600, to: 6400 },
  { from: 6500, to: 8100 },
] as const;

const T = {
  customer: 700,
  typing: 1650,
  reply: 2450,
  branch: 4050,
  resolved: 4350,
  nextDay: 5900,
  typing2: 6700,
  followUp: 7300,
  back: 8900,
  done: 9700,
  exit: 13000,
} as const;

/** Both cards stay for the whole loop: at the end the run's marks clear and
 *  the conversation empties, ready for the next message. */
export const automationScript: StoryScript = { duration: 14000, start: 600, poster: 11000, board: BOARDS.automation };

export function AutomationLoop({ paused }: { readonly paused: boolean }) {
  return (
    <StoryCanvas script={automationScript} paused={paused}>
      {(props) => <AutomationStory {...props} />}
    </StoryCanvas>
  );
}

export function AutomationStory({ t, layout }: StoryProps) {
  const tr = useT();
  const wide = layout === "wide";

  const geo = wide
    ? { flow: { left: 40, top: 20, width: 430 }, chat: { left: 530, top: 20, width: 470, maxHeight: 440 } }
    : { flow: { left: 16, top: 16, width: 328 }, chat: { left: 16, top: 330, width: 328, maxHeight: 240 } };

  // On a phone the conversation sits under the flow, following its foot.
  const [flow, flowHeight] = useHeight();
  const chatTop = wide || !flowHeight ? geo.chat.top : geo.flow.top + flowHeight + 14;
  const reply = tr("landing.demo.reply.lucia");
  const taken = ramp(t, T.branch, 360, ease.smooth) * (1 - ramp(t, T.exit, 400, ease.smooth));
  const followUp = tr("landing.demo.flow.step3Message");

  const steps: readonly { icon: IconSvgElement; title: string; body: ReactNode }[] = [
    { icon: Message01Icon, title: tr("landing.story.automation.s1Title"), body: "WhatsApp · Instagram" },
    { icon: AiElementsIcon, title: tr("landing.story.automation.s2Title"), body: tr("landing.story.automation.s2Body") },
    {
      icon: GitBranchIcon,
      title: tr("landing.story.automation.s3Title"),
      body: (
        <span className="mt-1 flex gap-1.5">
          <Branch label={tr("landing.story.automation.yes")} lit={taken} tone="success" />
          <Branch label={tr("landing.story.automation.no")} lit={0} dim={taken} tone="neutral" />
        </span>
      ),
    },
    { icon: Clock01Icon, title: tr("landing.story.automation.s4Title"), body: tr("landing.story.automation.s4Body") },
    { icon: SentIcon, title: tr("landing.story.automation.s5Title"), body: followUp },
  ];

  return (
    <>
      {/* ── The automation ── */}
      <Surface ref={flow} style={geo.flow}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
            <HugeiconsIcon icon={WorkflowSquare10Icon} size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.demo.flow.title")}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{tr("landing.story.automation.kind")}</p>
          </div>
          <Pill tone="success">{tr("landing.story.automation.active")}</Pill>
        </div>

        <div className="flex flex-col gap-1 px-2 py-2">
          {steps.map((step, index) => {
            const { from, to } = STEPS[index];
            const on = fade(t, from - 80, 260, to + 120, 320);
            const next = STEPS[index + 1];
            // The connector to the next step, lit once the run moves on.
            const lit = next ? ramp(t, next.from - 260, 420, ease.inOut) * (1 - ramp(t, T.exit, 400, ease.smooth)) : 0;
            return (
              <div key={step.title} className="relative flex items-start gap-3 rounded-[10px] px-2 py-2">
                <span aria-hidden="true" className="absolute inset-0 rounded-[10px] bg-accent" style={{ opacity: on * 0.75 }} />
                {next ? (
                  <span aria-hidden="true" className="absolute top-[46px] -bottom-[6px] left-[23.5px] w-px overflow-hidden rounded-full bg-foreground/15">
                    <span className="absolute inset-x-0 top-0 bg-foreground/55" style={{ height: `${(lit * 100).toFixed(1)}%` }} />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "relative flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted shadow-[var(--shadow-inset)] transition-none",
                    t >= from - 80 && t < T.exit ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <HugeiconsIcon icon={step.icon} size={15} strokeWidth={1.75} />
                </span>
                <div className="relative min-w-0 flex-1 pt-px">
                  <p className="truncate text-[13px] font-medium">{step.title}</p>
                  {wide || index === 2 ? <div className="truncate text-[12px] text-muted-foreground">{step.body}</div> : null}
                </div>
                <span className="relative pt-1.5">
                  <Progress t={t} at={from} done={to} until={T.exit} />
                </span>
              </div>
            );
          })}
        </div>

        {wide ? (
          <Arrive t={t} at={T.done} leave={T.exit}>
            <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} className="text-[var(--status-success-fg)]" />
              <span className="truncate">{tr("landing.story.automation.done")}</span>
            </div>
          </Arrive>
        ) : null}
      </Surface>

      {/* ── What the run does to the conversation ── */}
      <Surface
        className="flex flex-col"
        style={{ ...geo.chat, top: chatTop }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Avatar initials="LR" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">Lucía Romero</p>
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
              <ChannelIcon channel="instagram" className="size-3.5" />
              Instagram
            </p>
          </div>
        </div>
        <Thread>
          <Arrive t={t} at={T.customer} leave={T.exit}>
            <Bubble from="customer">{tr("landing.demo.msg.lucia")}</Bubble>
          </Arrive>
          <Arrive t={t} at={T.typing} leave={T.reply - 160}>
            <Typing t={t} />
          </Arrive>
          <Arrive t={t} at={T.reply} leave={T.exit + 50}>
            <Bubble from="oruka">
              <Words t={t} at={T.reply + 120} text={reply} gap={34} />
            </Bubble>
            <div
              className="mt-1.5 flex items-center justify-end gap-2.5 text-[11.5px] text-muted-foreground"
              style={{ opacity: fade(t, streamedUntil(reply, T.reply, 34) - 150, 360) }}
            >
              <SourceChip name={tr("landing.story.automation.source")} />
              <span>oruka · 3 s</span>
            </div>
          </Arrive>
          <Arrive t={t} at={T.resolved} leave={T.exit + 100}>
            <div className="flex justify-center">
              <Pill tone="neutral" icon={CheckmarkCircle02Icon}>
                {tr("landing.demo.flow.step2ThenNote")}
              </Pill>
            </div>
          </Arrive>
          <Arrive t={t} at={T.nextDay} leave={T.exit + 150}>
            <div className="flex items-center gap-3 py-1 text-[11.5px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {tr("landing.story.automation.nextDay")}
              <span className="h-px flex-1 bg-border" />
            </div>
          </Arrive>
          <Arrive t={t} at={T.typing2} leave={T.followUp - 160}>
            <Typing t={t} />
          </Arrive>
          <Arrive t={t} at={T.followUp} leave={T.exit + 200}>
            <Bubble from="oruka">
              <Words t={t} at={T.followUp + 120} text={followUp} gap={34} />
            </Bubble>
          </Arrive>
          <Arrive t={t} at={T.back} leave={T.exit + 250}>
            <Bubble from="customer">{tr("landing.story.automation.back")} 🙌</Bubble>
          </Arrive>
        </Thread>
      </Surface>
    </>
  );
}

function Branch({
  label,
  lit,
  dim = 0,
  tone,
}: {
  readonly label: string;
  readonly lit: number;
  readonly dim?: number;
  readonly tone: "success" | "neutral";
}) {
  return (
    <span className="relative inline-grid">
      <span className="pill pill-sm tone-pill tone-expired col-start-1 row-start-1" style={{ opacity: mix(1, 0.45, dim) }}>
        {label}
      </span>
      {tone === "success" ? (
        <span className="pill pill-sm tone-pill tone-success col-start-1 row-start-1" style={{ opacity: lit }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
