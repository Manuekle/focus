"use client";

/**
 * The Meta Ads story: a lead from a campaign gets its first message in
 * seconds, turns into a booking by morning, and the campaign counts it.
 *
 *   01  the lead form lands at 3:12 a.m. and the campaign's lead count ticks,
 *   02  eight seconds later oruka has written to her, on WhatsApp, with the
 *       campaign she came from pinned to the conversation,
 *   03  she answers when she wakes up and books a Saturday slot,
 *   04  and the booking goes back to the campaign: one more booking, a lower
 *       cost per booking. The spend now has an outcome next to it.
 *
 * On a phone the three surfaces take turns in the same place — campaign and
 * lead, then the conversation, then the campaign again — because a phone
 * frame has room for one thing to be read at a time.
 */

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Megaphone01Icon,
  Timer02Icon,
} from "@hugeicons/core-free-icons";
import type { CSSProperties, ReactNode } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { MetaMark } from "../brand-marks";
import {
  Arrive,
  Avatar,
  Bubble,
  Pill,
  PillSwap,
  Roll,
  StoryCanvas,
  type StoryProps,
  type StoryScript,
  Surface,
  Thread,
  Typed,
  Typing,
  useHeight,
  Wire,
  Words,
} from "./kit";
import { BOARDS } from "./boards";
import { counter, ease, fade, mix, ramp, reveal, streamedUntil, typed } from "./time";

const T = {
  lead: 650,
  name: 1000,
  phone: 1350,
  interest: 1700,
  leadCount: 1500,
  chat: 2350,
  typing: 2650,
  first: 3250,
  speed: 4300,
  night: 5400,
  nora1: 5900,
  reply2: 7000,
  nora2: 8250,
  booked: 8900,
  back: 9300,
  bookings: 9700,
  cost: 10000,
  exit: 13300,
} as const;

/** The campaign card stays for the whole loop; its figures roll back at the
 *  end while the lead and the conversation make way for the next lap. */
export const adsScript: StoryScript = { duration: 14200, start: 600, poster: 11200, board: BOARDS.ads };

export function AdsLoop({ paused }: { readonly paused: boolean }) {
  return (
    <StoryCanvas script={adsScript} paused={paused}>
      {(props) => <AdsStory {...props} />}
    </StoryCanvas>
  );
}

export function AdsStory({ t, layout }: StoryProps) {
  const tr = useT();
  const wide = layout === "wide";

  const geo = wide
    ? {
        campaign: { left: 40, top: 20, width: 430 },
        lead: { left: 40, top: 238, width: 430 },
        chat: { left: 530, top: 20, width: 470, maxHeight: 440 },
      }
    : {
        campaign: { left: 16, top: 16, width: 328 },
        lead: { left: 16, top: 260, width: 328 },
        chat: { left: 16, top: 16, width: 328, maxHeight: 420 },
      };

  const leave = (offset = 0) => ({ at: T.exit + offset, dur: 420, y: 8, blur: 8 });
  const [chat, chatHeight] = useHeight();
  // The lead card sits under the campaign card and follows its foot when the
  // campaign grows a line at the end.
  const [campaign, campaignHeight] = useHeight();
  const leadTop = campaignHeight ? geo.campaign.top + campaignHeight + (wide ? 18 : 14) : geo.lead.top;

  // Phone: campaign + lead, then the conversation, then the campaign again.
  const toChat = wide ? 0 : ramp(t, T.chat - 300, 700, ease.inOut) * (1 - ramp(t, T.back, 700, ease.inOut));
  const step = (amount: number): CSSProperties =>
    amount > 0.001
      ? { opacity: 1 - amount, transform: `translateY(${(-amount * 20).toFixed(2)}px) scale(${(1 - amount * 0.04).toFixed(4)})`, filter: `blur(${(amount * 6).toFixed(2)}px)` }
      : {};
  const chatIn = wide ? 1 : ramp(t, T.chat - 100, 700, ease.inOut);
  const chatOut = wide ? 0 : ramp(t, T.back, 700, ease.inOut);

  const leads = counter(t, "23", [[T.leadCount, "24"], [T.exit + 300, "23"]]);
  const bookings = counter(t, "6", [[T.bookings, "7"], [T.exit + 300, "6"]]);
  const costFrom = tr("landing.story.ads.costFrom");
  const cost = counter(t, costFrom, [[T.cost, tr("landing.story.ads.costTo")], [T.exit + 300, costFrom]]);
  const updated = fade(t, T.bookings - 100, 400, T.exit, 400);

  const first = tr("landing.story.ads.first");
  const reply2 = tr("landing.story.ads.reply2");

  return (
    <>

      <div className="absolute inset-0" style={step(toChat)}>
        {/* ── The campaign ── */}
        <Surface ref={campaign} style={geo.campaign}>
          <div className="flex items-center gap-3 px-4 pt-4 pb-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted shadow-[var(--shadow-inset)]">
              <MetaMark size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.story.ads.campaign")}</p>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{tr("landing.story.ads.spent")}</p>
            </div>
            <Pill tone="success">{tr("landing.story.ads.active")}</Pill>
          </div>
          <div className={cn("grid border-t border-border", wide ? "grid-cols-3" : "grid-cols-2")}>
            <Metric label="Leads" wide={wide} lit={fade(t, T.leadCount - 100, 300, T.leadCount + 1400, 600)}>
              <Roll t={t} {...leads} />
            </Metric>
            <Metric label={tr("landing.story.ads.bookings")} wide={wide} lit={fade(t, T.bookings - 100, 300, T.bookings + 1600, 600)}>
              <Roll t={t} {...bookings} />
            </Metric>
            <Metric label={tr("landing.story.ads.cost")} wide={wide} span lit={fade(t, T.cost - 100, 300, T.cost + 1600, 600)}>
              <Roll t={t} {...cost} />
            </Metric>
          </div>
          {wide ? (
          <Arrive t={t} at={T.bookings + 500} leave={T.exit}>
            <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground" style={{ opacity: updated }}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} className="text-[var(--status-success-fg)]" />
              {tr("landing.story.ads.attributed")}
            </div>
          </Arrive>
          ) : null}
        </Surface>

        {/* ── The lead form, as it lands ── */}
        <Surface
          style={{
            ...geo.lead,
            top: leadTop,
            ...reveal(t, T.lead, { dur: 620, y: 14, blur: 8 }, leave(60)),
          }}
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-[var(--status-progress-bg)] text-[var(--status-progress-fg)] shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={Megaphone01Icon} size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.story.ads.leadTitle")}</p>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{tr("landing.story.ads.leadSource")}</p>
            </div>
            <span className="rounded-[8px] bg-muted px-2 py-1 font-heading text-[12px] font-medium tabular-nums shadow-[var(--shadow-inset)]">03:12</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 px-4 py-3.5 text-[13px]">
            <Field t={t} at={T.name} label={tr("landing.story.ads.fieldName")} value="Nora Díaz" />
            <Field t={t} at={T.phone} label={tr("landing.story.ads.fieldPhone")} value={tr("landing.story.ads.phone")} />
            <Field t={t} at={T.interest} label={tr("landing.story.ads.fieldInterest")} value={tr("landing.story.ads.interest")} />
            <dt className="self-center text-muted-foreground" style={{ opacity: fade(t, T.interest + 500, 360) }}>
              {tr("landing.story.ads.fieldStatus")}
            </dt>
            <dd style={{ opacity: fade(t, T.interest + 500, 360) }}>
              <PillSwap
                t={t}
                at={T.back + 150}
                align="start"
                from={<Pill tone="progress">{tr("landing.story.ads.statusNew")}</Pill>}
                to={<Pill tone="success" icon={Calendar03Icon}>{tr("landing.story.ads.statusBooked")}</Pill>}
              />
            </dd>
          </dl>
        </Surface>
      </div>

      {/* ── oruka writes first ── */}
      {wide ? (
        <>
          <Wire t={t} at={T.chat - 250} from={[geo.lead.left + geo.lead.width, leadTop + 30]} to={[geo.chat.left, geo.chat.top + 34]} out={T.night} dur={600} />
          <Wire t={t} at={T.back} from={[geo.chat.left, geo.chat.top + chatHeight - 32]} to={[geo.campaign.left + geo.campaign.width, geo.campaign.top + 100]} out={T.exit} dur={700} />
        </>
      ) : null}
      <div
        className="absolute inset-0"
        style={wide ? undefined : { ...step(chatOut), visibility: chatIn <= 0.001 || chatOut >= 0.999 ? "hidden" : undefined }}
      >
        <Surface
          ref={chat}
          className="flex flex-col"
          style={{
            ...geo.chat,
            ...(wide
              ? reveal(t, T.chat, { dur: 620, x: 16, y: 0, blur: 8 }, leave(80))
              : { opacity: chatIn, transform: `translateY(${((1 - chatIn) * 28).toFixed(2)}px)`, filter: chatIn < 0.98 ? `blur(${((1 - chatIn) * 8).toFixed(2)}px)` : undefined }),
          }}
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
            <Avatar initials="ND" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">Nora Díaz</p>
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                <ChannelIcon channel="whatsapp" className="size-3.5" />
                WhatsApp
              </p>
            </div>
            <Pill tone="progress" icon={Megaphone01Icon} className={wide ? undefined : "max-w-[132px] overflow-hidden"}>
              <span className="truncate">{tr("landing.story.ads.campaign")}</span>
            </Pill>
          </div>
          <Thread>
            <Arrive t={t} at={T.typing} leave={T.first - 160}>
              <Typing t={t} />
            </Arrive>
            <Arrive t={t} at={T.first}>
              <Bubble from="oruka">
                <Words t={t} at={T.first + 120} text={first} gap={34} />
              </Bubble>
              <div className="mt-1.5 flex items-center justify-end gap-2 text-[11.5px] text-muted-foreground" style={{ opacity: fade(t, streamedUntil(first, T.first, 34) - 200, 360) }}>
                <span>oruka · 03:12</span>
                <span
                  className="pill pill-sm tone-pill tone-success"
                  style={reveal(t, T.speed, { dur: 460, y: 4, blur: 4, scale: 0.94 })}
                >
                  <HugeiconsIcon icon={Timer02Icon} size={11} strokeWidth={2} />
                  {tr("landing.story.ads.speed")}
                </span>
              </div>
            </Arrive>
            <Arrive t={t} at={T.night}>
              <div className="flex items-center gap-3 py-1 text-[11.5px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {tr("landing.story.ads.morning")}
                <span className="h-px flex-1 bg-border" />
              </div>
            </Arrive>
            <Arrive t={t} at={T.nora1}>
              <Bubble from="customer">{tr("landing.story.ads.nora1")}</Bubble>
            </Arrive>
            <Arrive t={t} at={T.nora1 + 600} leave={T.reply2 - 160}>
              <Typing t={t} />
            </Arrive>
            <Arrive t={t} at={T.reply2}>
              <Bubble from="oruka">
                <Words t={t} at={T.reply2 + 120} text={reply2} gap={34} />
              </Bubble>
            </Arrive>
            <Arrive t={t} at={T.nora2}>
              <Bubble from="customer">{tr("landing.story.ads.nora2")} 🙌</Bubble>
            </Arrive>
            <Arrive t={t} at={T.booked}>
              <div className="flex justify-center pt-1">
                <Pill tone="success" icon={Calendar03Icon}>
                  {tr("landing.story.ads.booked")}
                </Pill>
              </div>
            </Arrive>
          </Thread>
        </Surface>
      </div>
    </>
  );
}

function Metric({
  label,
  wide,
  span = false,
  lit = 0,
  children,
}: {
  readonly label: string;
  readonly wide: boolean;
  /** On a phone the last figure takes the whole second row. */
  readonly span?: boolean;
  readonly lit?: number;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative px-4 py-3",
        wide ? "border-r border-border last:border-r-0" : span ? "col-span-2 border-t border-border" : "border-border odd:border-r",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--status-success-bg)]"
        style={{ opacity: lit * 0.45 }}
      />
      <p className="relative truncate text-[11.5px] text-muted-foreground">{label}</p>
      <p className="relative mt-1 font-heading text-[20px] font-semibold tracking-[-0.02em] tabular-nums">{children}</p>
    </div>
  );
}

function Field({ t, at, label, value }: { readonly t: number; readonly at: number; readonly label: string; readonly value: string }) {
  const shown = typed(value, t, at, 40);
  const p = ramp(t, at - 150, 300, ease.smooth);
  return (
    <>
      <dt className="text-muted-foreground" style={{ opacity: mix(0.4, 1, p) }}>
        {label}
      </dt>
      <dd className="min-w-0 truncate font-medium">
        <Typed t={t} text={value} shown={shown} caret={shown.length < value.length && t > at - 150} />
      </dd>
    </>
  );
}
