"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { Clock01Icon, File01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useRef } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { type DemoStep, useDemoLoop } from "./demo-loop";
import { useStageLive } from "./use-stage-live";

/**
 * The hero's demo: one customer, one question, and what is left behind once
 * it has been answered.
 *
 * The screen it replaced was the owner's chat — picking a model, asking the
 * assistant for an automation — which is the product's settings, not its
 * work. A visitor who has just read "answers your customers" needs to see a
 * customer being answered, so this is a single story told in four beats:
 *
 *   1. a question arrives on WhatsApp,
 *   2. oruka answers from the business's own prices and books the table,
 *   3. the contact lands in the CRM with a next step scheduled,
 *   4. the team's inbox shows what still needs a person — and not this.
 *
 * The conversation and its result sit side by side from `md`, stacked below
 * it. Every element is always in the layout and only its opacity plays, so a
 * lap never moves the page under the reader.
 *
 * ── Why it opens on the finished story ───────────────────────────────
 *
 * The first phase of the loop is the last frame of the story, held. That is
 * the frame the server renders, the frame a reduced-motion visitor keeps, and
 * the frame on screen when the loop goes live after hydration — so nothing
 * flashes and empties itself on load. The lap clears and rebuilds from there.
 *
 * No pointer and no GSAP: nothing here is clicked, and this frame is above the
 * fold, so it renders with the page instead of behind a lazy import.
 */

const SCRIPT = [
  { phase: "done", ms: 5200 },
  { phase: "rest", ms: 900 },
  { phase: "ask", ms: 1700 },
  { phase: "typing", ms: 1300 },
  { phase: "answer", ms: 3400 },
  { phase: "confirm", ms: 1500 },
  { phase: "booked", ms: 2000 },
  { phase: "contact", ms: 1700 },
  { phase: "next", ms: 1900 },
] as const satisfies readonly DemoStep<string>[];

type Phase = (typeof SCRIPT)[number]["phase"];

/** The story's own order, which is not the script's: the script starts at the end. */
const STORY: readonly Phase[] = ["rest", "ask", "typing", "answer", "confirm", "booked", "contact", "next", "done"];

/** Which of the four beats each phase belongs to. `rest` lights none. */
const BEAT: Record<Phase, number> = {
  rest: -1,
  ask: 0,
  typing: 1,
  answer: 1,
  confirm: 1,
  booked: 1,
  contact: 2,
  next: 2,
  done: 3,
};

const BEATS: readonly string[] = [
  "landing.demo.story.step1",
  "landing.demo.story.step2",
  "landing.demo.story.step3",
  "landing.demo.story.step4",
];

export function ConversationScreen() {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const live = useStageLive(stage);
  const { phase } = useDemoLoop(SCRIPT, live);

  const shown: Phase = live ? phase : "done";
  const at = STORY.indexOf(shown);
  const from = (mark: Phase) => at >= STORY.indexOf(mark);
  const beat = BEAT[shown];

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] bg-background md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      data-demo={live ? "playing" : "still"}
      ref={stage}
    >
      {/* The four beats as one progress rail across the top: a segment per
          step, filled as the story reaches it, the step being played in full
          ink. Below `sm` only the playing step is named. */}
      <div className="col-span-full border-border border-b px-4 pt-4 pb-3.5 sm:px-6">
        <ol className="grid grid-cols-4 gap-2 sm:gap-4">
          {BEATS.map((key, index) => (
            <li className="min-w-0" key={key}>
              <span className="block h-[3px] overflow-hidden rounded-full bg-border">
                <span
                  className={cn(
                    "block h-full rounded-full transition-[width,background-color] duration-500 ease-[var(--lp-ease)]",
                    index === beat ? "bg-foreground" : "bg-foreground/30",
                  )}
                  style={{ width: index <= beat ? "100%" : "0%" }}
                />
              </span>
              <span
                className={cn(
                  "mt-2.5 hidden items-baseline gap-1.5 text-xs transition-colors duration-300 sm:flex",
                  index === beat ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="font-mono text-[10px] tabular-nums">{`0${index + 1}`}</span>
                <span className="truncate">{t(key)}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 flex items-baseline gap-1.5 text-foreground text-xs sm:hidden">
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{`0${Math.max(beat, 0) + 1}`}</span>
          {t(BEATS[Math.max(beat, 0)])}
        </p>
      </div>

      {/* ── The conversation ─────────────────────────────────────────── */}
      <div className="border-border border-b p-4 sm:p-6 md:border-r md:border-b-0">
        <div className="flex items-center gap-3 border-border border-b pb-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
            VR
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">Valentina Ríos</p>
            <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <ChannelIcon channel="whatsapp" className="size-3.5" />
              WhatsApp
            </p>
          </div>
          {/* The example is said where the conversation is, in the voice of
              a label rather than a sticker. */}
          <p className="shrink-0 text-right text-[11px] text-muted-foreground leading-tight">
            {t("landing.demo.story.example")}
            <span className="block text-foreground/80">{t("landing.demo.story.business")}</span>
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2.5 text-[13px] leading-relaxed">
          <Bubble from="customer" shown={from("ask")}>
            {t("landing.demo.story.customer1")}
          </Bubble>

          <div className="relative flex flex-col items-end gap-1.5">
            <Typing shown={shown === "typing"} />
            <Bubble from="agent" shown={from("answer")}>
              {t("landing.demo.story.reply1")}
            </Bubble>
            {/* Where the answer came from. The price is the business's, not
                the model's, and this is the one place the demo says so. */}
            <Appear className="flex items-center gap-1.5 text-[11px] text-muted-foreground" shown={from("answer")}>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5">
                <HugeiconsIcon icon={File01Icon} size={12} strokeWidth={1.75} />
                {t("landing.demo.story.source")}
              </span>
              <span>{t("landing.demo.story.repliedBy")}</span>
            </Appear>
          </div>

          <Bubble from="customer" shown={from("confirm")}>
            {t("landing.demo.story.customer2")}
          </Bubble>
          <Bubble from="agent" shown={from("booked")}>
            {t("landing.demo.story.reply2")}
          </Bubble>
        </div>
      </div>

      {/* ── What it left behind ──────────────────────────────────────── */}
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        <Result shown={from("contact")} title={t("landing.demo.story.contactTitle")}>
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[11px] text-muted-foreground">
              VR
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[13px]">Valentina Ríos</p>
              <p className="truncate text-muted-foreground text-xs">+54 9 11 4402-3318</p>
            </div>
            <StatusBadge label={t("landing.demo.story.contactStage")} status="success" />
          </div>
          <p className="mt-2.5 truncate text-muted-foreground text-xs">{t("landing.demo.story.contactInterest")}</p>
        </Result>

        <Result shown={from("next")} title={t("landing.demo.story.nextTitle")}>
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <HugeiconsIcon icon={Clock01Icon} size={15} strokeWidth={1.75} />
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug">{t("landing.demo.story.nextBody")}</p>
            <StatusBadge label={t("landing.demo.story.nextTag")} status="paused" />
          </div>
        </Result>

        {/* The inbox lists conversations that need a person, so the story's
            own customer is not in it — which is the point of the beat. */}
        <Result
          hint={t("landing.demo.story.inboxHint")}
          shown={from("done")}
          title={t("landing.demo.story.inboxTitle")}
        >
          <div className="divide-y divide-border">
            <InboxRow
              message={t("landing.demo.msg.carlos")}
              name="Carlos Ruiz"
              status={<StatusBadge label={t("inbox.handoff")} status="warning" />}
            />
            <InboxRow
              message={t("landing.demo.msg.maria")}
              name="María Fernández"
              status={<StatusBadge label={t("inbox.followup")} status="pending" />}
            />
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 border-border border-t pt-2.5 text-muted-foreground text-xs">
            <HugeiconsIcon
              className="shrink-0 text-emerald-600 dark:text-emerald-400"
              icon={Tick02Icon}
              size={14}
              strokeWidth={2}
            />
            <span className="truncate">{t("landing.demo.story.resolved")}</span>
          </p>
        </Result>
      </div>

      {/* Room for the frame's veil: it dissolves the last ~140px of every
          window, and that should be empty floor rather than the inbox. */}
      <div aria-hidden="true" className="col-span-full h-20 sm:h-24" />
    </div>
  );
}

/** Fades and lifts into a place that was always reserved for it. */
function Appear({
  children,
  className,
  shown,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly shown: boolean;
}) {
  return (
    <div
      className={cn(
        "transition-[opacity,transform] duration-500 ease-[var(--lp-ease)]",
        shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Bubble({
  children,
  from,
  shown,
}: {
  readonly children: ReactNode;
  readonly from: "agent" | "customer";
  readonly shown: boolean;
}) {
  return (
    <Appear className={cn("max-w-[86%]", from === "agent" ? "self-end" : "self-start")} shown={shown}>
      <p
        className={cn(
          "rounded-2xl px-3.5 py-2.5",
          from === "agent"
            ? "rounded-tr-md bg-primary text-primary-foreground"
            : "rounded-tl-md border border-border bg-card text-foreground",
        )}
      >
        {children}
      </p>
    </Appear>
  );
}

/** Three dots over the slot the answer is about to fill. */
function Typing({ shown }: { readonly shown: boolean }) {
  return (
    <span
      className={cn(
        "absolute top-0 right-0 flex gap-1 rounded-2xl rounded-tr-md bg-muted px-3.5 py-3.5 transition-opacity duration-200",
        shown ? "opacity-100" : "opacity-0",
      )}
    >
      {[0, 1, 2].map((dot) => (
        <span
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70"
          key={dot}
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
    </span>
  );
}

function Result({
  children,
  hint,
  shown,
  title,
}: {
  readonly children: ReactNode;
  readonly hint?: string;
  readonly shown: boolean;
  readonly title: string;
}) {
  return (
    <Appear shown={shown}>
      <div className="rounded-2xl border border-border bg-card p-3.5 shadow-[var(--shadow-soft)] sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <HugeiconsIcon
            className="shrink-0 text-emerald-600 dark:text-emerald-400"
            icon={Tick02Icon}
            size={14}
            strokeWidth={2}
          />
          <p className="min-w-0 flex-1 truncate font-medium text-xs">{title}</p>
          {hint ? <p className="hidden truncate text-[11px] text-muted-foreground sm:block">{hint}</p> : null}
        </div>
        {children}
      </div>
    </Appear>
  );
}

function InboxRow({
  message,
  name,
  status,
}: {
  readonly message: string;
  readonly name: string;
  readonly status: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2 first:pt-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <ChannelIcon channel="whatsapp" className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-xs">{name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{message}</p>
      </div>
      {status}
    </div>
  );
}
