"use client";

/**
 * The hero's story: one WhatsApp question becomes a booking.
 *
 *   01  a customer asks for a table and the price of the set menu,
 *   02  oruka looks it up in the restaurant's own menu — the rows it reads
 *       light up — and answers with that price,
 *   03  she says yes, and the booking, the CRM contact and tomorrow's
 *       reminder are done while the reply is still arriving,
 *   04  and none of it reached the team: nobody had to step in.
 *
 * The document is the point of step 02. "Answers from your data" is a claim
 * every chatbot makes; watching the answer's number being found in a file is
 * the part that makes it believable.
 */

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Calendar03Icon,
  Clock01Icon,
  File01Icon,
  AiIdeaIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { OrukaTile } from "@/components/icons/oruka-mark";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  Arrive,
  Avatar,
  Bubble,
  Check,
  Pill,
  PillSwap,
  Progress,
  Shimmer,
  SourceChip,
  StoryCanvas,
  type StoryProps,
  type StoryScript,
  Surface,
  Thread,
  Tile,
  Typing,
  useHeight,
  Wire,
  Words,
} from "./kit";
import { BOARDS } from "./boards";
import { bump, ease, fade, mix, ramp, reveal, streamedUntil } from "./time";

const T = {
  m1: 650,
  search: 1500,
  scan: 1900,
  found: 3050,
  r1: 3500,
  doc: 6000,
  m2: 6250,
  r2: 7600,
  actions: 8100,
  a1: 8550,
  a2: 9150,
  a3: 9750,
  resolved: 10900,
  exit: 13200,
} as const;

/** The conversation card never leaves: at the end of a lap its messages
 *  clear and the next lap's question arrives in the same card. */
export const chatScript: StoryScript = { duration: 14000, start: 620, poster: 12400, board: BOARDS.chat };

const DOC_ROWS = [1, 2, 3, 4] as const;
/** The rows of the menu the answer is built from. */
const MATCH = new Set([1, 3]);

export function ChatLoop({ paused }: { readonly paused: boolean }) {
  return (
    <StoryCanvas script={chatScript} paused={paused}>
      {(props) => <ChatStory {...props} />}
    </StoryCanvas>
  );
}

export function ChatStory({ t, layout }: StoryProps) {
  const tr = useT();
  const wide = layout === "wide";

  const geo = wide
    ? { chat: { left: 40, top: 20, width: 470, maxHeight: 440 }, side: { left: 570, width: 430 }, doc: 40, actions: 76 }
    : { chat: { left: 16, top: 16, width: 328, maxHeight: 300 }, side: { left: 16, width: 328 }, doc: 330, actions: 330 };

  // The thread grows with its messages, so the wires that leave it follow its
  // foot. Measured after each frame's layout; the board is unscaled here.
  const [chat, chatHeight] = useHeight();
  const chatFoot = geo.chat.top + chatHeight;

  const leave = (offset = 0) => ({ at: T.exit + offset, dur: 420, y: 8, blur: 8 });

  const reply1 = tr("landing.demo.story.reply1");
  const reply2 = tr("landing.demo.story.reply2");

  return (
    <>

      {/* ── The conversation ── */}
      <Surface ref={chat} className="flex flex-col" style={geo.chat}>
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <Avatar initials="VR" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">Valentina Ríos</p>
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
              <ChannelIcon channel="whatsapp" className="size-3.5" />
              WhatsApp
            </p>
          </div>
          <span className="font-heading text-[12px] text-muted-foreground tabular-nums">19:02</span>
        </div>
        <Thread>
          <Arrive t={t} at={T.m1} leave={T.exit}>
            <Bubble from="customer">{tr("landing.demo.story.customer1")}</Bubble>
          </Arrive>
          <Arrive t={t} at={T.search + 200} leave={T.r1 - 160}>
            <Typing t={t} />
          </Arrive>
          <Arrive t={t} at={T.r1} leave={T.exit + 60}>
            <Bubble from="oruka">
              <Words t={t} at={T.r1 + 120} text={reply1} gap={34} />
            </Bubble>
            <div
              className="mt-1.5 flex items-center justify-end gap-2.5 text-[11.5px] text-muted-foreground"
              style={{ opacity: fade(t, streamedUntil(reply1, T.r1, 34) - 150, 360) }}
            >
              <SourceChip name={tr("landing.demo.story.source")} />
              <span>{tr("landing.demo.story.repliedBy")}</span>
            </div>
          </Arrive>
          <Arrive t={t} at={T.m2} leave={T.exit + 120}>
            <Bubble from="customer">{tr("landing.demo.story.customer2")} 🙌</Bubble>
          </Arrive>
          <Arrive t={t} at={T.m2 + 650} leave={T.r2 - 160}>
            <Typing t={t} />
          </Arrive>
          <Arrive t={t} at={T.r2} leave={T.exit + 180}>
            <Bubble from="oruka">
              <Words t={t} at={T.r2 + 120} text={reply2} gap={34} />
            </Bubble>
          </Arrive>
        </Thread>
      </Surface>

      {/* ── Step 02: the answer is looked up ── */}
      {wide ? (
        <Wire t={t} at={T.found - 150} from={[geo.side.left, geo.doc + 134]} to={[geo.chat.left + geo.chat.width, chatFoot - 82]} out={T.doc} dur={650} />
      ) : null}
      <Surface
        style={{
          left: geo.side.left,
          top: geo.doc,
          width: geo.side.width,
          ...reveal(t, T.search, { dur: 600, x: wide ? 16 : 0, y: wide ? 0 : 12, blur: 8 }, { at: T.doc, dur: 420, x: wide ? 12 : 0, y: wide ? 0 : 8, blur: 8 }),
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12.5px]">
          <HugeiconsIcon icon={AiIdeaIcon} size={14} strokeWidth={1.75} className="text-[var(--btn-ai-bg)]" />
          <span className="relative grid flex-1">
            <span className="col-start-1 row-start-1" style={{ opacity: 1 - ramp(t, T.found, 300) }}>
              <Shimmer t={t}>{tr("landing.story.chat.searching")}</Shimmer>
            </span>
            <span className="col-start-1 row-start-1 font-medium" style={{ opacity: ramp(t, T.found, 300) }}>
              {tr("landing.story.chat.found")}
            </span>
          </span>
        </div>
        <div className="px-4 pt-3.5 pb-4">
          <div className="flex items-center gap-3">
            <Tile icon={File01Icon} className="size-8 rounded-[10px]" size={15} />
            <div className="min-w-0">
              <p className="truncate font-heading text-[13.5px] font-semibold">{tr("landing.demo.story.source")}</p>
              <p className="text-[11.5px] text-muted-foreground">{tr("landing.story.chat.docMeta")}</p>
            </div>
          </div>
          <div className="relative mt-3 overflow-hidden rounded-[12px] border border-border bg-background/60">
            {/* The reading head: one pass down the page. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 h-[34px] bg-[color-mix(in_oklab,var(--btn-ai-bg)_8%,transparent)]"
              style={{
                top: mix(-34, (wide ? 4 : 3) * 34, ramp(t, T.scan, 1050, ease.inOut)),
                opacity: bump(t, T.scan - 100, T.scan + 1150),
              }}
            />
            {DOC_ROWS.slice(0, wide ? 4 : 3).map((row) => {
              const hit = MATCH.has(row) ? ramp(t, T.found + (row === 3 ? 120 : 0), 420, ease.smooth) : 0;
              return (
                <div
                  key={row}
                  className="relative flex h-[34px] items-center justify-between gap-3 border-b border-border/60 px-3 text-[12.5px] last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[2px] bg-[var(--btn-ai-bg)]"
                    style={{ opacity: hit, transform: `scaleY(${hit.toFixed(3)})` }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 bg-[var(--status-progress-bg)]"
                    style={{ opacity: hit * 0.7 }}
                  />
                  <span className="relative text-muted-foreground">{tr(`landing.story.chat.row${row}Label`)}</span>
                  <span
                    className={cn("relative tabular-nums", hit > 0.5 ? "font-medium text-foreground" : "text-muted-foreground")}
                  >
                    {tr(`landing.story.chat.row${row}Value`)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Surface>

      {/* ── Step 03: what the conversation left behind ── */}
      {wide ? (
        <Wire t={t} at={T.actions - 50} from={[geo.chat.left + geo.chat.width, chatFoot - 52]} to={[geo.side.left, geo.actions + 120]} out={T.exit} dur={650} />
      ) : null}
      <Surface
        style={{
          left: geo.side.left,
          top: geo.actions,
          width: geo.side.width,
          ...reveal(t, T.actions, { dur: 620, x: wide ? 16 : 0, y: wide ? 0 : 12, blur: 8 }, leave(80)),
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <OrukaTile className="size-[22px] rounded-[7px]" />
          <span className="font-heading text-[14px] font-semibold tracking-[-0.005em]">{tr("landing.story.chat.actionsTitle")}</span>
        </div>
        <div className="flex flex-col px-2 py-1.5">
          <ActionRow
            t={t}
            at={T.a1}
            icon={Calendar03Icon}
            title={tr("landing.story.chat.bookingTitle")}
            body={tr("landing.story.chat.bookingBody")}
            status={<Progress t={t} at={T.a1 + 150} done={T.a1 + 750} />}
          />
          <ActionRow
            t={t}
            at={T.a2}
            icon={UserIcon}
            title={tr("landing.story.chat.contactTitle")}
            body={wide ? "Valentina Ríos · +54 9 11 4402-3318" : "Valentina Ríos"}
            status={
              <PillSwap
                t={t}
                at={T.a2 + 800}
                from={<Pill tone="progress">{tr("landing.story.chat.stageNew")}</Pill>}
                to={<Pill tone="success">{tr("landing.demo.story.contactStage")}</Pill>}
              />
            }
          />
          <ActionRow
            t={t}
            at={T.a3}
            icon={Clock01Icon}
            title={tr("landing.story.chat.nextTitle")}
            body={wide ? tr("landing.story.chat.nextBody") : tr("landing.story.chat.nextShort")}
            status={<Pill tone="pending" style={{ opacity: ramp(t, T.a3 + 450, 360) }}>{tr("landing.demo.story.nextTag")}</Pill>}
          />
        </div>
        <Arrive t={t} at={T.resolved}>
          <div className="flex items-center gap-2.5 border-t border-border px-4 py-3 text-[12.5px]">
            <Check t={t} at={T.resolved + 200} size={13} />
            <span className="min-w-0 truncate text-muted-foreground">{tr("landing.story.chat.resolved")}</span>
          </div>
        </Arrive>
      </Surface>
    </>
  );
}

function ActionRow({
  t,
  at,
  icon,
  title,
  body,
  status,
}: {
  readonly t: number;
  readonly at: number;
  readonly icon: Parameters<typeof Tile>[0]["icon"];
  readonly title: string;
  readonly body: string;
  readonly status: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-2 py-2" style={reveal(t, at, { dur: 520, y: 8, blur: 5 })}>
      <Tile icon={icon} className="size-8 rounded-[10px]" size={15} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium tracking-[-0.005em]">{title}</p>
        <p className="truncate text-[12px] text-muted-foreground">{body}</p>
      </div>
      <div className="shrink-0">{status}</div>
    </div>
  );
}
