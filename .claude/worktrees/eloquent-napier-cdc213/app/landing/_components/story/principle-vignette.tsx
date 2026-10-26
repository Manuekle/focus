"use client";

/**
 * One small moment for each principle, drawn with the story kit:
 *
 *   attend   a question comes in and oruka answers it,
 *   sell     a lead moves through the pipeline to won,
 *   follow   a day passes and the follow-up goes out — and gets an answer.
 *
 * They play once when they come into view (under five seconds, so there is
 * nothing to pause) and again when the pointer comes back to them. Without
 * motion, and on the server, they show their last frame.
 */

import { HugeiconsIcon } from "@/components/icons/icon";
import { CheckmarkCircle02Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useAnimationActive } from "@/lib/hooks/use-animation-active";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { MetaMark } from "../brand-marks";
import { Arrive, Avatar, Bubble, Roll, Typing } from "./kit";
import { counter, ease, mix, ramp } from "./time";

type Principle = "attend" | "sell" | "follow";

const DURATION: Record<Principle, number> = { attend: 3000, sell: 3400, follow: 4000 };

/**
 * A clock that runs once, from 0 to `duration`, each time `ref` comes into
 * view; `replay` starts it again once it has finished. Offscreen it rewinds,
 * so the next visit plays from the top.
 */
function useOnce(ref: RefObject<HTMLElement | null>, duration: number, delay: number) {
  const live = useAnimationActive(ref);
  const reduced = useReducedMotion();
  const [t, setT] = useState(duration);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let frame = 0;
    if (reduced) {
      frame = requestAnimationFrame(() => setT(duration));
      return () => cancelAnimationFrame(frame);
    }
    if (!live) {
      frame = requestAnimationFrame(() => setT(-delay));
      return () => cancelAnimationFrame(frame);
    }
    let last = performance.now();
    let now = -delay;
    const tick = (stamp: number) => {
      now = Math.min(duration, now + Math.min(stamp - last, 50));
      last = stamp;
      setT(now);
      if (now < duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, reduced, duration, delay, run]);

  const replay = () => {
    if (!reduced && t >= duration) setRun((value) => value + 1);
  };
  return { t, replay };
}

export function PrincipleVignette({ id, delay = 0 }: { readonly id: Principle; readonly delay?: number }) {
  const node = useRef<HTMLDivElement>(null);
  const { t, replay } = useOnce(node, DURATION[id], delay);
  return (
    <div ref={node} aria-hidden="true" onPointerEnter={replay} className="relative h-[124px]">
      <div inert className="absolute inset-0">
        {id === "attend" ? <Attend t={t} /> : id === "sell" ? <Sell t={t} /> : <Follow t={t} />}
      </div>
    </div>
  );
}

const SMALL = "px-3 py-2 text-[12.5px] leading-[1.4]";

function Attend({ t }: { readonly t: number }) {
  const tr = useT();
  return (
    <div className="flex h-full flex-col justify-end gap-2">
      <Arrive t={t} at={0}>
        <Bubble from="customer" className={SMALL}>
          {tr("landing.principles.vignette.attendAsk")}
        </Bubble>
      </Arrive>
      <Arrive t={t} at={700} leave={1500}>
        <Typing t={t} className="h-8 w-[52px]" />
      </Arrive>
      <Arrive t={t} at={1660}>
        <Bubble from="oruka" className={SMALL}>
          {tr("landing.principles.vignette.attendReply")}
        </Bubble>
        <p className="mt-1 text-right text-[11px] text-muted-foreground" style={{ opacity: ramp(t, 2300, 400) }}>
          oruka · 3 s
        </p>
      </Arrive>
    </div>
  );
}

const STAGES = [
  { key: "stageNew", tone: "progress", at: 0 },
  { key: "stageTalk", tone: "pending", at: 1100 },
  { key: "stageWon", tone: "success", at: 2300 },
] as const;

function Sell({ t }: { readonly t: number }) {
  const tr = useT();
  return (
    <div className="flex h-full flex-col justify-end gap-4">
      <div className="flex items-center gap-2.5">
        <Avatar initials="ND" className="size-8 text-[11px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">Nora Díaz</p>
          <p className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            <MetaMark size={12} />
            Meta Ads
          </p>
        </div>
      </div>
      {/* Pills and connectors as siblings, so every connector gets the same share of the row. */}
      <div className="flex items-center gap-2">
        {STAGES.flatMap((stage, index) => {
          const reached = index === 0 ? 1 : ramp(t, stage.at, 420, ease.smooth);
          const label = tr(`landing.principles.vignette.${stage.key}`);
          const pill = (
            <span key={stage.key} className="relative inline-grid shrink-0">
              <span className="pill tone-pill tone-expired col-start-1 row-start-1" style={{ opacity: 1 - reached }}>
                {label}
              </span>
              <span
                className={cn("pill tone-pill col-start-1 row-start-1", `tone-${stage.tone}`)}
                style={{ opacity: reached, transform: `scale(${mix(0.96, 1, reached).toFixed(4)})` }}
              >
                {stage.key === "stageWon" ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} /> : null}
                {label}
              </span>
            </span>
          );
          const next = STAGES[index + 1];
          if (!next) return [pill];
          const travel = ramp(t, next.at - 500, 500, ease.inOut);
          return [
            pill,
            <span key={`${stage.key}-line`} className="relative h-px min-w-3 flex-1 overflow-hidden rounded-full bg-foreground/15">
              <span className="absolute inset-y-0 left-0 bg-foreground/55" style={{ width: `${(travel * 100).toFixed(1)}%` }} />
            </span>,
          ];
        })}
      </div>
    </div>
  );
}

function Follow({ t }: { readonly t: number }) {
  const tr = useT();
  const wait = ramp(t, 200, 1500, ease.inOut);
  const when = counter(t, tr("landing.principles.vignette.followIn"), [[1700, tr("landing.principles.vignette.followNow")]]);
  return (
    <div className="flex h-full flex-col justify-end gap-2">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={Clock01Icon} size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[13px] font-medium">{tr("landing.principles.vignette.followTitle")}</p>
            <Roll t={t} {...when} className="text-[11.5px] text-muted-foreground" />
          </div>
          <span className="relative mt-1.5 block h-[3px] overflow-hidden rounded-full bg-foreground/10">
            <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/55" style={{ width: `${(wait * 100).toFixed(1)}%` }} />
          </span>
        </div>
      </div>
      <Arrive t={t} at={1850}>
        <Bubble from="oruka" className={SMALL}>
          {tr("landing.principles.vignette.followMsg")}
        </Bubble>
      </Arrive>
      <Arrive t={t} at={2900}>
        <Bubble from="customer" className={SMALL}>
          {tr("landing.principles.vignette.followBack")}
        </Bubble>
      </Arrive>
    </div>
  );
}
