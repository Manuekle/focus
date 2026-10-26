"use client";

/**
 * The inbox story: oruka takes the conversations, the team only gets the one
 * that needs a person — with what oruka already learned — and one click hands
 * it back.
 *
 *   01  messages keep arriving on the left and oruka resolves them, one after
 *       another, while the count of what it handled climbs,
 *   02  Carlos asks for a person: his row turns into a handoff and lands in
 *       the team's inbox, which until then had nothing in it,
 *   03  opening it shows what oruka already knows, so Sofía answers without
 *       asking him to repeat himself,
 *   04  "Resume agent": the pill turns green, the team inbox is empty again
 *       and Carlos is back with oruka.
 *
 * It ends where it started — an empty team inbox — which is the claim.
 */

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  CustomerSupportIcon,
  AiMail01Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import type { CSSProperties, ReactNode } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  Arrive,
  Bubble,
  Check,
  Cursor,
  Pill,
  PillSwap,
  pressStyle,
  Roll,
  Shimmer,
  StoryCanvas,
  type StoryProps,
  type StoryScript,
  Surface,
  useBoardPoints,
  Wire,
  Words,
} from "./kit";
import { BOARDS } from "./boards";
import { counter, ease, fade, mix, ramp, reveal, travel } from "./time";

const T = {
  lucia: 700,
  luciaDone: 1750,
  tomas: 2050,
  tomasDone: 3050,
  carlos: 3450,
  handoff: 4300,
  lands: 4650,
  cursorIn: 5300,
  open: 6050,
  known: 6500,
  reply: 8100,
  toResume: 9500,
  resume: 10300,
  close: 11000,
  leave: 11550,
  exit: 13300,
} as const;

/** Both cards stay on the board for the whole loop: the new rows leave at the
 *  end and the count rolls back, so a lap ends where the next one starts. */
export const inboxScript: StoryScript = { duration: 14200, start: 600, poster: 9300, board: BOARDS.inbox };

export function InboxLoop({ paused }: { readonly paused: boolean }) {
  return (
    <StoryCanvas script={inboxScript} paused={paused}>
      {(props) => <InboxStory {...props} />}
    </StoryCanvas>
  );
}

type Row = {
  readonly name: string;
  readonly channel: "whatsapp" | "instagram";
  readonly message: string;
  /** When it arrives; undefined = already there when the lap opens. */
  readonly at?: number;
  /** When oruka has answered it. */
  readonly done?: number;
};

const LIST_FADE = { "--y-fade-top": "0px", "--y-fade-bottom": "56px" } as CSSProperties;

export function InboxStory({ t, layout }: StoryProps) {
  const tr = useT();
  const wide = layout === "wide";
  const [anchor, points] = useBoardPoints<"chevron" | "resume">();

  const geo = wide
    ? { list: { left: 40, top: 20, width: 430, maxHeight: 400 }, team: { left: 520, top: 20, width: 480 } }
    : { list: { left: 16, top: 16, width: 328, maxHeight: 238 }, team: { left: 16, top: 268, width: 328 } };


  const rows: readonly Row[] = [
    { name: "Carlos Ruiz", channel: "whatsapp", message: tr("landing.demo.msg.carlos"), at: T.carlos },
    { name: "Tomás Gil", channel: "whatsapp", message: tr("landing.demo.msg.tomas"), at: T.tomas, done: T.tomasDone },
    { name: "Lucía Romero", channel: "instagram", message: tr("landing.demo.msg.lucia"), at: T.lucia, done: T.luciaDone },
    { name: "Paula Ibáñez", channel: "instagram", message: tr("landing.demo.msg.paula") },
    { name: "Diego Paz", channel: "instagram", message: tr("landing.demo.msg.diego") },
    { name: "María Fernández", channel: "whatsapp", message: tr("landing.demo.msg.maria") },
  ];

  const handled = counter(t, "12", [
    [T.luciaDone + 200, "13"],
    [T.tomasDone + 200, "14"],
    [T.resume + 500, "15"],
    [T.exit + 300, "12"],
  ]);
  const waiting = counter(t, "0", [
    [T.lands, "1"],
    [T.leave, "0"],
  ]);

  // The pointer: in from the corner, onto the row's chevron, then down to
  // "Resume agent", then away.
  const chevron = points.chevron ?? { x: geo.team.left + geo.team.width - 30, y: geo.team.top + 100 };
  const resume = points.resume ?? { x: geo.team.left + geo.team.width - 80, y: geo.team.top + 300 };
  const pointer = travel(t, [
    { at: 0, x: geo.team.left + geo.team.width - 20, y: geo.team.top + (wide ? 420 : 300) },
    { at: T.cursorIn, x: chevron.x + 4, y: chevron.y + 4, dur: 760 },
    { at: T.toResume, x: resume.x + 18, y: resume.y + 6, dur: 760 },
    { at: T.close + 200, x: resume.x + 140, y: resume.y + 160, dur: 900 },
  ]);
  const pointerOpacity = fade(t, T.cursorIn - 150, 300, T.close + 350, 420);

  const expanded = ramp(t, T.open, 620, ease.smooth) * (1 - ramp(t, T.close, 560, ease.smooth));
  // A phone has no room for both cards open: the list steps back and the team
  // card rises into its place while Carlos is open, and both return after.
  const focus = wide ? 0 : ramp(t, T.open - 250, 700, ease.inOut) * (1 - ramp(t, T.close, 700, ease.inOut));
  const listFocus: CSSProperties = focus > 0.001
    ? { opacity: 1 - focus, transform: `translateY(${(-focus * 24).toFixed(2)}px) scale(${(1 - focus * 0.04).toFixed(4)})`, filter: `blur(${(focus * 6).toFixed(2)}px)` }
    : {};

  return (
    <>

      {/* ── Every conversation, as it comes in ── */}
      <div className="absolute inset-0" style={listFocus}>
      <Surface className="flex flex-col" style={geo.list}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <p className="font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.story.inbox.listTitle")}</p>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {wide ? tr("landing.story.inbox.handled") : null}
            <span className="flex h-6 min-w-6 items-center justify-center rounded-[8px] bg-muted px-1.5 text-[12.5px] font-semibold text-foreground shadow-[var(--shadow-inset)]">
              <Roll t={t} {...handled} />
            </span>
          </span>
        </div>
        <div className="y-fade flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1.5" style={wide ? undefined : LIST_FADE}>
          {rows.map((row) => {
            const body = (
              <ListRow
                key={row.name}
                row={row}
                wide={wide}
                status={
                  row.name === "Carlos Ruiz" ? (
                    <PillSwap
                      t={t}
                      at={T.handoff}
                      from={<Replying t={t} label={tr("landing.story.inbox.replying")} />}
                      to={
                        <PillSwap
                          t={t}
                          at={T.resume + 300}
                          from={<Pill tone="pending" icon={TriangleAlertIcon}>{tr("landing.story.inbox.handoff")}</Pill>}
                          to={<Done label={tr("landing.story.inbox.done")} />}
                        />
                      }
                    />
                  ) : row.done === undefined ? (
                    <Done label={tr("landing.story.inbox.done")} />
                  ) : (
                    <PillSwap
                      t={t}
                      at={row.done}
                      from={<Replying t={t} label={tr("landing.story.inbox.replying")} />}
                      to={<Done label={tr("landing.story.inbox.done")} />}
                    />
                  )
                }
                highlight={row.name === "Carlos Ruiz" ? fade(t, T.handoff, 360, T.leave, 600) : 0}
              />
            );
            return row.at === undefined ? (
              <div key={row.name}>{body}</div>
            ) : (
              <Arrive key={row.name} t={t} at={row.at} leave={T.exit + (row.name === "Carlos Ruiz" ? 0 : row.name === "Tomás Gil" ? 90 : 180)}>
                {body}
              </Arrive>
            );
          })}
        </div>
      </Surface>

      </div>

      {/* ── The handoff travels to the team ── */}
      {wide ? (
        <Wire
          t={t}
          at={T.handoff + 80}
          from={[geo.list.left + geo.list.width, geo.list.top + 84]}
          to={[geo.team.left, geo.team.top + 104]}
          out={T.leave}
          dur={560}
        />
      ) : null}

      {/* ── The team's inbox: only what needs a person ── */}
      <Surface style={{ ...geo.team, top: mix(geo.team.top, geo.list.top, focus) }}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
            <HugeiconsIcon icon={CustomerSupportIcon} size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.demo.story.inboxTitle")}</p>
            {wide ? <p className="mt-0.5 text-[12px] text-muted-foreground">{tr("landing.demo.story.inboxHint")}</p> : null}
          </div>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-[8px] bg-muted px-1.5 text-[12.5px] font-semibold shadow-[var(--shadow-inset)]">
            <Roll t={t} {...waiting} />
          </span>
        </div>

        {/* Empty, then Carlos, then empty again. */}
        <Arrive t={t} at={-1000} leave={T.lands - 200}>
          <Empty label={tr("landing.story.inbox.empty")} />
        </Arrive>
        <Arrive t={t} at={T.leave + 380}>
          <Empty label={tr("landing.story.inbox.empty")} />
        </Arrive>

        <Arrive t={t} at={T.lands} leave={T.leave}>
          <div className="px-2 py-2">
            <div
              className="rounded-[10px]"
              style={{ backgroundColor: `color-mix(in oklab, var(--muted) ${(expanded * 70).toFixed(1)}%, transparent)` }}
            >
              <div className="flex items-center gap-3 px-2 py-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <ChannelIcon channel="whatsapp" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">Carlos Ruiz</p>
                  <p className="truncate text-[12px] text-muted-foreground">{tr("landing.demo.msg.carlos")}</p>
                </div>
                <PillSwap
                  t={t}
                  at={T.resume + 80}
                  from={<Pill tone="pending" icon={TriangleAlertIcon}>{tr("landing.story.inbox.handoff")}</Pill>}
                  to={<Pill tone="success" icon={CheckmarkCircle02Icon}>{tr("landing.story.inbox.resumed")}</Pill>}
                />
                <span
                  ref={anchor("chevron")}
                  className="flex size-7 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground"
                  style={{ ...pressStyle(t, T.open - 60), backgroundColor: `color-mix(in oklab, var(--accent) ${(fade(t, T.cursorIn + 500, 200, T.open + 300) * 100).toFixed(1)}%, transparent)` }}
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={14}
                    strokeWidth={1.75}
                    style={{ transform: `rotate(${(expanded * 180).toFixed(1)}deg)` }}
                  />
                </span>
              </div>

              {/* What oruka already learned, and the person who takes it from there. */}
              <div className="grid grid-cols-[minmax(0,1fr)]" style={{ gridTemplateRows: `${expanded.toFixed(4)}fr` }}>
                <div className="min-h-0 overflow-hidden">
                  <div className="px-2 pt-1 pb-3" style={{ opacity: expanded }}>
                    <p className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
                      {/* The same 18px box as the checks below, so the column lines up. */}
                      <span className="flex size-[18px] shrink-0 items-center justify-center">
                        <HugeiconsIcon icon={AiMail01Icon} size={13} strokeWidth={1.75} className="text-[var(--btn-ai-bg)]" />
                      </span>
                      {t < T.known + 1300 ? <Shimmer t={t}>{tr("landing.story.inbox.known")}</Shimmer> : tr("landing.story.inbox.known")}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {(["fact1", "fact2", "fact3"] as const).map((fact, index) => {
                        const at = T.known + 250 + index * 330;
                        return (
                          <li key={fact} className="flex items-center gap-2 text-[13px]" style={reveal(t, at, { dur: 460, x: -6, y: 0, blur: 4 })}>
                            <Check t={t} at={at + 120} size={12} />
                            {tr(`landing.story.inbox.${fact}`)}
                          </li>
                        );
                      })}
                    </ul>
                    <Arrive t={t} at={T.reply} className="pt-3">
                      <p className="mb-1 text-right text-[11.5px] text-muted-foreground">{tr("landing.story.inbox.teamWho")}</p>
                      <Bubble from="team" className="max-w-[92%]">
                        <Words t={t} at={T.reply + 120} text={tr("landing.story.inbox.teamReply")} gap={36} />
                      </Bubble>
                    </Arrive>
                    <div className="mt-3 flex justify-end" style={{ opacity: fade(t, T.reply + 900, 360) }}>
                      <span
                        ref={anchor("resume")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[12.5px] font-medium shadow-[var(--shadow-button)]"
                        style={pressStyle(t, T.resume - 60)}
                      >
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} />
                        {tr("landing.story.inbox.resume")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Arrive>
      </Surface>

      <Cursor t={t} x={pointer.x} y={pointer.y} presses={[T.open - 60, T.resume - 60]} opacity={pointerOpacity} />
    </>
  );
}

function ListRow({
  row,
  wide,
  status,
  highlight,
}: {
  readonly row: Row;
  readonly wide: boolean;
  readonly status: ReactNode;
  readonly highlight: number;
}) {
  return (
    <div
      className="relative flex items-center gap-3 rounded-[10px] px-2 py-2.5"
      style={{ backgroundColor: `color-mix(in oklab, var(--status-pending-bg) ${(highlight * 45).toFixed(1)}%, transparent)` }}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
        <ChannelIcon channel={row.channel} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{row.name}</p>
        <p className="truncate text-[12px] text-muted-foreground">{row.message}</p>
      </div>
      <div className={cn("flex shrink-0 justify-end", wide ? "min-w-[104px]" : "min-w-[88px]")}>{status}</div>
    </div>
  );
}

function Replying({ t, label }: { readonly t: number; readonly label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <HugeiconsIcon icon={AiMail01Icon} size={12} strokeWidth={1.75} className="text-[var(--btn-ai-bg)]" />
      <Shimmer t={t}>{label}</Shimmer>
    </span>
  );
}

function Done({ label }: { readonly label: string }) {
  return (
    <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={1.75} className="text-[var(--status-success-fg)]" />
      {label}
    </span>
  );
}

function Empty({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-7 text-[12.5px] text-muted-foreground">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={15} strokeWidth={1.75} />
      {label}
    </div>
  );
}
