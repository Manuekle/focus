"use client";

/**
 * The agents story: an agent is described in a sentence, assembled by
 * oruka, given a model and its channels, and joins the others.
 *
 *   01  the owner writes what the agent should do, in their own words,
 *   02  oruka turns that into the agent's parts — instructions, tools,
 *       knowledge, channels — each one ticking off as it is set up,
 *   03  the model is picked, WhatsApp and Instagram are switched on, and the
 *       draft becomes active,
 *   04  the card shrinks into its place in the team, next to the agents that
 *       were already working.
 *
 * The card in step 04 is the same element as the one being built, travelling
 * to its slot — so it reads as "this agent joined", not as a new screen.
 */

import { HugeiconsIcon } from "@/components/icons/icon";
import {
  CheckmarkCircle02Icon,
  File01Icon,
  Mic01Icon,
  AiImagineIcon,
  TaskDone01Icon,
  UserSwitchIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { CSSProperties, ReactNode } from "react";
import { ChannelIcon } from "@/app/_components/channel-badge";
import { VoiceOrb } from "@/components/elevenlabs/voice-orb";
import { ClaudeLogo, GeminiLogo, OpenAiLogo } from "@/components/provider-logo";
import { getAgentTemplate } from "@/lib/agent-templates";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  Arrive,
  Cursor,
  Pill,
  PillSwap,
  pressStyle,
  Progress,
  Shimmer,
  Spin,
  StoryCanvas,
  type StoryProps,
  type StoryScript,
  Surface,
  Swap,
  Typed,
  useBoardPoints,
} from "./kit";
import { BOARDS } from "./boards";
import { ease, fade, mix, ramp, reveal, settle, travel, typed, typedUntil } from "./time";

const T = {
  type: 700,
  create: 3500,
  build: 3750,
  part: 4200,
  configure: 7000,
  model: 7400,
  whatsapp: 8150,
  instagram: 8550,
  activate: 9450,
  team: 10350,
  exit: 13300,
} as const;

/** The composer is on the board at both ends of the lap, so a loop never
 *  passes through an empty stage. */
export const agentsScript: StoryScript = { duration: 14200, start: 600, poster: 12200, board: BOARDS.agents };

export function AgentsLoop({ paused }: { readonly paused: boolean }) {
  return (
    <StoryCanvas script={agentsScript} paused={paused}>
      {(props) => <AgentsStory {...props} />}
    </StoryCanvas>
  );
}

const PARTS = [
  { key: "b1", icon: TaskDone01Icon },
  { key: "b2", icon: Wrench01Icon },
  { key: "b3", icon: File01Icon },
  { key: "b4", icon: UserSwitchIcon },
] as const;

/** The team, each on the template the app gives that role (`lib/agent-templates.ts`). */
const TEAM = [
  { template: "leadQualifier", name: "agentTemplates.leadQualifier.name", description: "agentTemplates.leadQualifier.description" },
  { template: "salesFollowUp", name: "agentTemplates.salesFollowUp.name", description: "agentTemplates.salesFollowUp.description" },
  { template: "support", name: "agentTemplates.support.name", description: "agentTemplates.support.description" },
] as const;

export function AgentsStory({ t, layout, running }: StoryProps) {
  const tr = useT();
  const wide = layout === "wide";
  const [anchor, points] = useBoardPoints<"create" | "claude" | "activate">();

  const prompt = tr("landing.story.agents.prompt");
  const promptDone = typedUntil(prompt, T.type, 44);

  // ── Geometry ──
  const compose = wide ? { left: 220, top: 110, width: 600 } : { left: 16, top: 120, width: 328 };
  const composeDocked = wide ? { left: 40, top: 20, width: 420 } : compose;
  const card = wide ? { left: 500, top: 20, width: 500 } : { left: 16, top: 16, width: 328 };
  // The team is the "My agents" list: one row per agent, the new one first.
  const tile = (index: number) =>
    wide ? { left: 160, top: 70 + index * 84, width: 720 } : { left: 16, top: 40 + index * 84, width: 328 };

  // Docked while the agent is built; centred again (and unseen) once it has
  // left, so it can come back in place for the next lap.
  const dock = t < T.team ? settle(t, T.build - 100, 900) : 0;
  const toTeam = settle(t, T.team, 1000);
  const composer = wide
    ? {
        left: mix(compose.left, composeDocked.left, dock),
        top: mix(compose.top, composeDocked.top, dock),
        width: mix(compose.width, composeDocked.width, dock),
      }
    : compose;
  // On a phone the composer steps back when the agent card takes the stage.
  const composerBack = wide ? 0 : ramp(t, T.build - 100, 700, ease.inOut) * (1 - ramp(t, T.exit - 150, 600, ease.inOut));
  // The composer steps out when the agent joins the team and comes back,
  // empty, as the team leaves: the board is never bare between laps.
  const composerOut = ramp(t, T.team - 150, 420, ease.in) * (1 - ramp(t, T.exit - 150, 620, ease.out));
  const fresh = t >= T.exit - 150;
  const target = tile(0);
  const agent = {
    left: mix(card.left, target.left, toTeam),
    top: mix(card.top, target.top, toTeam),
    width: mix(card.width, target.width, toTeam),
  };
  const body = 1 - ramp(t, T.team - 100, 600, ease.smooth);
  const built = ramp(t, T.configure - 250, 650, ease.smooth);

  const leave = (offset = 0) => ({ at: T.exit + offset, dur: 420, y: 8, blur: 8 });

  const create = points.create ?? { x: compose.left + compose.width - 70, y: compose.top + 150 };
  const claude = points.claude ?? { x: card.left + 90, y: card.top + 200 };
  const activate = points.activate ?? { x: card.left + card.width - 80, y: card.top + 340 };
  const pointer = travel(t, [
    { at: 0, x: Math.min(compose.left + compose.width + 60, (wide ? 1040 : 360) - 24), y: compose.top + 260 },
    { at: promptDone - 400, x: create.x + 6, y: create.y + 6, dur: 700 },
    { at: T.model - 650, x: claude.x + 8, y: claude.y + 6, dur: 800 },
    { at: T.activate - 750, x: activate.x + 14, y: activate.y + 6, dur: 800 },
    { at: T.activate + 450, x: activate.x + 120, y: activate.y + 120, dur: 900 },
  ]);
  const pointerOpacity =
    fade(t, promptDone - 600, 300, T.create + 350, 300) + fade(t, T.model - 800, 300, T.activate + 500, 400);

  const channelOn = (at: number) => ramp(t, at, 320, ease.smooth);

  return (
    <>

      {/* ── 01: described in a sentence ── */}
      <div className="absolute inset-0" style={backStyle(composerBack)}>
        <Surface
          style={{
            ...composer,
            opacity: 1 - composerOut,
            transform: `translateY(${(-composerOut * 6).toFixed(2)}px)`,
            filter: composerOut > 0.02 && composerOut < 0.98 ? `blur(${(composerOut * 4).toFixed(2)}px)` : undefined,
            visibility: composerOut > 0.999 ? "hidden" : undefined,
          }}
        >
          <div className="flex items-center gap-2.5 px-4 pt-4">
            <HugeiconsIcon icon={AiImagineIcon} size={15} strokeWidth={2} className="text-[var(--btn-ai-bg)]" />
            <p className="font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.story.agents.composerTitle")}</p>
          </div>
          <p className="px-4 pt-1 text-[12px] text-muted-foreground">{tr("landing.story.agents.composerHint")}</p>
          <div className="mx-4 mt-3 min-h-[66px] rounded-[12px] border border-border bg-background/60 px-3.5 py-3 text-[13.5px] leading-[1.5] shadow-[var(--shadow-inset)]">
            <Typed t={t} text={prompt} shown={fresh ? "" : typed(prompt, t, T.type, 44)} caret={t < T.create + 200 || fresh} />
          </div>
          <div className="flex justify-end px-4 pt-3 pb-4">
            <span
              ref={anchor("create")}
              className="inline-flex h-9 items-center gap-1.5 rounded-[11px] bg-[var(--btn-ai-bg)] px-3.5 text-[13px] font-medium text-white shadow-[0_1px_2px_oklch(0_0_0/0.12),inset_0_1px_0_oklch(1_0_0/0.18)]"
              style={{ ...pressStyle(t, T.create - 60), opacity: mix(0.45, 1, ramp(t, promptDone - 200, 300) * (1 - ramp(t, T.exit - 150, 240))) }}
            >
              <Swap
                t={t}
                items={[
                  {
                    at: 0,
                    node: (
                      <>
                        <HugeiconsIcon icon={AiImagineIcon} size={14} strokeWidth={2} />
                        {tr("landing.story.agents.create")}
                      </>
                    ),
                  },
                  {
                    at: T.create + 80,
                    node: (
                      <>
                        <Spin t={t} size={14} />
                        {tr("landing.story.agents.creating")}
                      </>
                    ),
                  },
                  {
                    at: T.configure - 250,
                    node: (
                      <>
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={2} />
                        {tr("landing.story.agents.created")}
                      </>
                    ),
                  },
                  {
                    at: T.exit - 150,
                    node: (
                      <>
                        <HugeiconsIcon icon={AiImagineIcon} size={14} strokeWidth={2} />
                        {tr("landing.story.agents.create")}
                      </>
                    ),
                  },
                ]}
              />
            </span>
          </div>
        </Surface>
      </div>

      {/* ── 02–04: the agent, built, configured, then filed with the team ── */}
      {TEAM.map((member, index) => (
        <Surface
          key={member.template}
          style={{ ...tile(index + 1), ...reveal(t, T.team + 250 + index * 110, { dur: 640, y: 14, blur: 8 }, leave(60 + index * 50)) }}
        >
          <TeamRow
            template={member.template}
            name={tr(member.name)}
            description={tr(member.description)}
            status={<Pill tone="success">{tr("landing.story.agents.active")}</Pill>}
          />
        </Surface>
      ))}

      <Surface
        style={{
          ...agent,
          ...reveal(t, T.build, { dur: 640, x: wide ? 20 : 0, y: wide ? 0 : 16, blur: 8 }, leave()),
          boxShadow: `inset 0 1px 0 var(--lp-bevel, oklch(1 0 0 / 0.9)), var(--story-shadow), 0 0 0 ${(2 * fade(t, T.team + 500, 400, T.team + 2400, 900)).toFixed(2)}px color-mix(in oklab, var(--btn-ai-bg) 55%, transparent)`,
        }}
      >
        {/* While oruka builds: the AI orb, at work. It folds away into the
            agent's own header once the parts are in. */}
        <Fold open={1 - built}>
          <div className="flex flex-col items-center gap-3 px-4 pt-7 pb-5" style={{ opacity: 1 - built }}>
            {/* The voice playground's blue orb, the app's large AI element.
                It runs its own GPU loop, so it is only mounted while it can
                be seen. */}
            {t > T.build - 300 && t < T.configure + 500 ? (
              <VoiceOrb agentState="thinking" paused={!running} className="size-[72px]" />
            ) : (
              <span className="size-[72px]" />
            )}
            <p className="text-[13.5px] font-medium">
              <Shimmer t={t}>{tr("landing.story.agents.building")}</Shimmer>
            </p>
          </div>
        </Fold>
        <Fold open={built}>
          <div className="flex items-center gap-3 px-4 py-3.5" style={{ opacity: ramp(t, T.configure - 100, 400) }}>
            <AgentAvatar template="receptionist" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">{tr("landing.story.agents.name")}</p>
              <p className="truncate text-[12px] text-muted-foreground">{tr("landing.story.agents.description")}</p>
            </div>
            <PillSwap
              t={t}
              at={T.activate + 100}
              from={<Pill tone="neutral">{tr("landing.story.agents.draft")}</Pill>}
              to={<Pill tone="success">{tr("landing.story.agents.active")}</Pill>}
            />
          </div>
        </Fold>

        <div className="grid grid-cols-[minmax(0,1fr)]" style={{ gridTemplateRows: `${body.toFixed(4)}fr` }}>
          <div className="min-h-0 overflow-hidden" style={{ opacity: body }}>
            {/* The parts, as oruka sets each one up. */}
            <div className="grid grid-cols-[minmax(0,1fr)]" style={{ gridTemplateRows: `${(1 - ramp(t, T.configure - 100, 600, ease.smooth)).toFixed(4)}fr` }}>
              <div className="min-h-0 overflow-hidden border-t border-border">
                <div className="flex flex-col px-2 py-1.5">
                  {PARTS.map((part, index) => {
                    const at = T.part + index * 520;
                    return (
                      <Arrive key={part.key} t={t} at={at}>
                      <div className="flex items-center gap-3 rounded-[10px] px-2 py-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                          <HugeiconsIcon icon={part.icon} size={15} strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{tr(`landing.story.agents.${part.key}Title`)}</p>
                          <p className="truncate text-[12px] text-muted-foreground">{tr(`landing.story.agents.${part.key}Body`)}</p>
                        </div>
                        <Progress t={t} at={at + 100} done={at + 760} />
                      </div>
                      </Arrive>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Model and channels, then on. */}
            <Arrive t={t} at={T.configure}>
              <div className="border-t border-border px-4 py-3.5">
                <p className="text-[12px] font-medium text-muted-foreground">{tr("landing.story.agents.model")}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <ModelChip
                    label="Claude"
                    logo={<ClaudeLogo size={15} />}
                    selected={ramp(t, T.model, 360, ease.smooth)}
                    anchor={anchor("claude")}
                    style={pressStyle(t, T.model - 60)}
                  />
                  <ModelChip label="OpenAI" logo={<OpenAiLogo size={15} />} selected={0} />
                  <ModelChip label="Gemini" logo={<GeminiLogo size={15} />} selected={0} />
                </div>
              </div>
              <div className="border-t border-border px-4 py-3">
                <p className="text-[12px] font-medium text-muted-foreground">{tr("landing.story.agents.channels")}</p>
                <div className="mt-1.5 flex flex-col">
                  <ChannelRow label="WhatsApp" icon={<ChannelIcon channel="whatsapp" />} on={channelOn(T.whatsapp)} />
                  <ChannelRow label="Instagram" icon={<ChannelIcon channel="instagram" />} on={channelOn(T.instagram)} />
                  {wide ? (
                    <ChannelRow label={tr("landing.story.agents.voice")} icon={<HugeiconsIcon icon={Mic01Icon} size={16} strokeWidth={1.75} />} on={0} />
                  ) : null}
                </div>
              </div>
              <div className="flex justify-end border-t border-border px-4 py-3">
                <span
                  ref={anchor("activate")}
                  className="inline-flex h-9 items-center rounded-[11px] bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-button)]"
                  style={pressStyle(t, T.activate - 60)}
                >
                  {tr("landing.story.agents.activate")}
                </span>
              </div>
            </Arrive>
          </div>
        </div>
      </Surface>

      <Cursor t={t} x={pointer.x} y={pointer.y} presses={[T.create - 60, T.model - 60, T.activate - 60]} opacity={Math.min(1, pointerOpacity)} />
    </>
  );
}

function backStyle(amount: number): CSSProperties {
  return amount > 0.001
    ? {
        opacity: 1 - amount,
        transform: `translateY(${(-amount * 24).toFixed(2)}px) scale(${(1 - amount * 0.04).toFixed(4)})`,
        filter: `blur(${(amount * 6).toFixed(2)}px)`,
        visibility: amount >= 0.999 ? "hidden" : undefined,
      }
    : {};
}

/** An agent's avatar exactly as the app draws it (`AgentSharedAvatar`): its template's tile. */
function AgentAvatar({ template }: { readonly template: string }) {
  const found = getAgentTemplate(template);
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[var(--shadow-inset)]", found?.accent)}>
      {found ? <HugeiconsIcon icon={found.icon} size={20} strokeWidth={1.75} /> : null}
    </span>
  );
}

/** A section that opens from nothing and folds back, pushing what is below it. */
function Fold({ open, children }: { readonly open: number; readonly children: ReactNode }) {
  if (open <= 0.0005) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]" style={{ gridTemplateRows: `${open.toFixed(4)}fr` }}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function ModelChip({
  label,
  logo,
  selected,
  anchor,
  style,
}: {
  readonly label: string;
  readonly logo: ReactNode;
  readonly selected: number;
  readonly anchor?: (node: HTMLElement | null) => void;
  readonly style?: CSSProperties;
}) {
  return (
    <span
      ref={anchor}
      className="flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card text-[12.5px] font-medium"
      style={{
        ...style,
        boxShadow: `0 0 0 ${(selected * 1.5).toFixed(2)}px var(--btn-ai-bg), 0 0 0 ${(selected * 4).toFixed(2)}px color-mix(in oklab, var(--btn-ai-bg) 18%, transparent)`,
      }}
    >
      {logo}
      {label}
    </span>
  );
}

function ChannelRow({ label, icon, on }: { readonly label: string; readonly icon: ReactNode; readonly on: number }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
      <span className="flex size-7 items-center justify-center rounded-[9px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">{icon}</span>
      <span className="flex-1">{label}</span>
      <span
        className="relative h-5 w-[43px] shrink-0 rounded-full shadow-[var(--switch-track-shadow)]"
        style={{ backgroundColor: `color-mix(in oklab, var(--switch-on) ${(on * 100).toFixed(1)}%, var(--switch-off))` }}
      >
        <span
          className="absolute top-[3px] left-[3px] h-3.5 w-[21px] rounded-full bg-[var(--switch-thumb)] shadow-[var(--switch-thumb-shadow)]"
          style={{ transform: `translateX(${(on * 16).toFixed(2)}px)` }}
        />
      </span>
    </div>
  );
}

function TeamRow({
  template,
  name,
  description,
  status,
}: {
  readonly template: string;
  readonly name: string;
  readonly description: string;
  readonly status: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <AgentAvatar template={template} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-[15px] font-semibold tracking-[-0.01em]">{name}</p>
        <p className="truncate text-[12px] text-muted-foreground">{description}</p>
      </div>
      {status}
    </div>
  );
}
