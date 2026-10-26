"use client";

import "@/components/iso/iso.css";
import "./anatomy.css";
import * as React from "react";
import { Dots, Line, Solid } from "@/components/iso/draw";
import { useInView, useLoop } from "@/components/iso/live";
import { useI18n } from "@/lib/i18n/provider";
import { put } from "./live-solid";
import { Nap, settle, type Motion } from "./motion";
import {
  BENCH,
  CARD_ART,
  CARRIAGE_ART,
  DIVIDER_ART,
  DRAWER,
  FOLLOWER,
  GANTRY,
  HEIGHT,
  LIFTER,
  LIMITS,
  MOVE,
  RODS,
  SCREW,
  STANDING,
  STUB_ART,
  WIDTH,
} from "./knowledge-geometry";
import { CARDS, MATCHES, PASSAGES, QUESTIONS, TOP, riseOf } from "./knowledge-model";

/**
 * Fig 05.1, "Your own knowledge": an edge-notched card file.
 *
 * Every passage of every document you uploaded is a card in the drawer, behind
 * its document's divider. A question is one of four selector rods that run
 * through every card; the carriage on the beam drops its lifter, slides across
 * to the question's rod and lifts it, and each card rides up on that rod by how
 * close it is to the question. The five that stand tallest are the five the
 * agent reads; the tallest is the one it cites. See `knowledge-model.ts`.
 *
 * Only transforms move. The cards, the lifted rod, the lifter and the lead
 * screw are drawn once at rest and translated; nothing is rebuilt per frame.
 */

const { DROP, LIFT } = LIMITS;
/** How far the lifter must be below a rod for its saddle to pass under the nuts: a saddle's height and a little. */
const CLEAR = 1.3;
const QUESTION_COUNT = QUESTIONS.length;
/** Seconds between questions on the idle tour. */
const DWELL = 6.4;
/** Seconds after the pointer leaves before the tour takes over again. */
const RESUME = 3.6;

type Rank = "best" | "top" | "rest";

function rankOf(card: number, question: number): Rank {
  const matches = MATCHES[question] ?? [];
  if (matches[0] === card) return "best";
  return matches.includes(card) ? "top" : "rest";
}

// ── the art, in painter's order ─────────────────────────────────────────

const BENCH_ART = (
  <g key="bench">
    <path className="iso-halo" d={BENCH.halo} />
    {BENCH.feet.map((parts, index) => (
      <g key={index}>
        {parts.map((paths, part) => (
          <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} crease="faint" />
        ))}
      </g>
    ))}
    <Solid paths={BENCH.slab} tone="mid" crease="faint" />
    <Line d={BENCH.groove} tone="faint" />
    <Line d={BENCH.screwRings} tone="lo" />
    <Dots points={BENCH.screws} size={0.55} tone="mid" />
    <Solid paths={BENCH.ruler} tone="lo" crease="none" />
    <Line d={BENCH.rulerMinor} tone="lo" />
    <Line d={BENCH.rulerMajor} tone="mid" />
    <Dots points={BENCH.rulerScrews} size={0.45} tone="mid" />
    <Solid paths={BENCH.label} tone="lo" crease="none" />
    <Line d={BENCH.labelLine} tone="faint" />
    <Line d={BENCH.labelRules} tone="lo" free />
    <Dots points={BENCH.labelScrews} size={0.45} tone="mid" />
  </g>
);

function PostArt({ index }: { index: number }) {
  const post = GANTRY.posts[index]!;
  return (
    <g>
      <Solid paths={post.foot} tone="lo" crease="faint" />
      <Dots points={post.footScrews} size={0.45} tone="mid" />
      <Solid paths={post.collar} tone="mid" crease="faint" />
      <Solid paths={post.post} tone="mid" crease="none" inner={<Line d={post.seams} tone="faint" />} />
    </g>
  );
}

const DRAWER_BACK = (
  <g key="drawer-back">
    <path className="iso-halo lp-shadow" d={DRAWER.halo} />
    {DRAWER.skids.map((paths, index) => (
      <Solid key={index} paths={paths} tone="lo" crease="none" />
    ))}
    <Solid paths={DRAWER.floor} tone="mid" crease="faint" />
    <Solid paths={DRAWER.farWall} tone="mid" crease="faint" />
    <Solid paths={DRAWER.backWall} tone="mid" crease="faint" />
  </g>
);

const FOLLOWER_ART = (
  <g key="follower">
    <Solid paths={FOLLOWER.plate} tone="mid" crease="faint" />
    <Solid paths={FOLLOWER.block} tone="mid" crease="faint" />
    <Solid paths={FOLLOWER.screw} tone="mid" crease="none" inner={<Line d={FOLLOWER.chamfers} tone="lo" />} />
    <Line d={FOLLOWER.knurl} tone="lo" />
    <Line d={FOLLOWER.screwTop} tone="lo" />
  </g>
);

const DRAWER_FRONT = (
  <g key="drawer-front">
    <Solid paths={DRAWER.nearWall} tone="mid" crease="faint" inner={<Line d={DRAWER.nearSeam} tone="faint" />} />
    <Dots points={DRAWER.nearRivets} size={0.45} tone="mid" />
    <Solid paths={DRAWER.front} tone="mid" crease="faint" />
    <path className="lp-void" d={DRAWER.slots} />
    <Line d={DRAWER.slots} tone="lo" />
    <Dots points={DRAWER.frontRivets} size={0.5} tone="mid" />
    <path className="kn-holder" d={DRAWER.holder} />
    <Line d={DRAWER.holder} tone="mid" />
    <Line d={DRAWER.holderCard} tone="faint" />
    <Line d={DRAWER.holderRules} tone="lo" free />
    <Dots points={DRAWER.holderRivets} size={0.5} tone="mid" />
  </g>
);

const BEAM_ART = (
  <g key="beam">
    <Solid paths={GANTRY.beam} tone="mid" crease="faint" />
    <Dots points={GANTRY.beamScrews} size={0.55} tone="mid" />
    <Solid paths={GANTRY.rail} tone="mid" crease="none" />
    {GANTRY.stops.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="faint" />
    ))}
    <Solid paths={GANTRY.scale} tone="lo" crease="none" />
    <Line d={GANTRY.scaleMinor} tone="lo" />
    <Line d={GANTRY.scaleMajor} tone="mid" />
  </g>
);

const SCREW_ROD = (
  <>
    <Solid paths={SCREW.rod} tone="mid" crease="none" inner={<Line d={SCREW.threads} tone="lo" />} />
  </>
);

// ── the live figure ─────────────────────────────────────────────────────

type State = {
  /** The question the carriage serves now; it changes only with the lifter down. */
  question: number;
  /** The question asked. */
  want: number;
  across: Motion;
  lift: Motion;
  clock: number;
  /** When the pointer last steered, in tour-clock seconds, or null while the tour drives. */
  steered: number | null;
  next: number;
  shown: string;
  /** What the parts were last written for, so a frame with nothing moving writes nothing. */
  drawn: string;
};

const restOf = (question: number) => RODS[question] ?? RODS[0];

export function KnowledgeFigure() {
  const { locale, t } = useI18n();
  const root = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const cards = React.useRef<(SVGGElement | null)[]>([]);
  const stubs = React.useRef<(SVGGElement | null)[]>([]);
  const arm = React.useRef<SVGGElement>(null);
  const layer = React.useRef<SVGGElement>(null);
  const carriage = React.useRef<SVGGElement>(null);
  const screws = React.useRef<(SVGGElement | null)[]>([]);
  const inView = useInView(root);

  const state = React.useRef<State>({
    question: 0,
    want: 0,
    across: { x: restOf(0), v: 0 },
    lift: { x: LIFT, v: 0 },
    clock: 0,
    steered: null,
    next: DWELL,
    shown: "",
    drawn: "",
  });

  const number = React.useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale]);

  const resultOf = React.useCallback(
    (question: number) => {
      const best = MATCHES[question]?.[0] ?? 0;
      const card = CARDS[best]!;
      const asked = t(`landing.capabilities.art.knowledge.question.${QUESTIONS[question]!.id}`);
      const from = t(`landing.capabilities.art.knowledge.document.${card.document}`);
      return `“${asked}” · ${t("landing.capabilities.art.knowledge.result", { top: TOP, count: PASSAGES })} · ${from} ${number.format(card.scores[question] ?? 0)}`;
    },
    [number, t],
  );
  const searching = t("landing.capabilities.art.knowledge.searching", { count: PASSAGES });

  /** Writes every moving part from the state. */
  const draw = React.useCallback(() => {
    const s = state.current;
    const y = s.across.x;
    const h = s.lift.x;
    const raised = Math.max(0, h);
    const settled = h >= LIFT - 0.4 && s.question === s.want;
    const key = `${y.toFixed(3)} ${h.toFixed(3)} ${s.question} ${settled}`;
    if (key === s.drawn) return;
    s.drawn = key;

    put(carriage.current, "transform", MOVE.across(y));
    for (const screw of screws.current) put(screw, "transform", MOVE.up(h));
    put(arm.current, "transform", MOVE.both(y, h));

    // The lifter is drawn among the rod ends by how far across it is, so it
    // passes under the nearer ones and over the ones behind.
    const container = layer.current;
    const lifter = arm.current;
    if (container && lifter) {
      const before = stubs.current.find((stub, index) => stub && (RODS[index] ?? 0) >= y - 0.5) ?? null;
      if (lifter.nextSibling !== before) container.insertBefore(lifter, before);
    }

    stubs.current.forEach((stub, index) => {
      const on = index === s.question;
      put(stub, "transform", MOVE.up(on ? raised : 0));
      put(stub, "data-on", on && raised > 0 ? "" : null);
    });

    cards.current.forEach((card, index) => {
      if (!card) return;
      put(card, "transform", MOVE.up(riseOf(CARDS[index]!, s.question, raised)));
      const rank = settled ? rankOf(index, s.question) : null;
      put(card, "data-rank", rank);
      put(card.firstElementChild, "data-lit", rank === "best" ? "" : null);
    });

    const text = settled ? resultOf(s.question) : searching;
    if (text !== s.shown && readout.current) {
      readout.current.textContent = text;
      s.shown = text;
    }
  }, [resultOf, searching]);

  const nap = React.useRef<Nap | null>(null);
  const tick = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      s.clock += dt;

      if (calm) s.next = Number.POSITIVE_INFINITY;
      else if (s.steered === null && s.clock >= s.next) {
        s.want = (s.want + 1) % QUESTION_COUNT;
        s.next = s.clock + DWELL;
      } else if (s.steered !== null && s.clock - s.steered > RESUME && !root.current?.matches(":hover")) {
        s.steered = null;
        s.next = s.clock + 1.4;
      }

      // Change rods only once the saddle is clear under every nut; lift only on arrival.
      const clear = s.lift.x <= -CLEAR;
      if (s.want !== s.question && clear) s.question = s.want;
      const there = Math.abs(s.across.x - restOf(s.question)) < 0.15 && Math.abs(s.across.v) < 1.5;
      const liftTo = s.want === s.question && there ? LIFT : -DROP;
      const lifting = settle(s.lift, liftTo, dt, liftTo > s.lift.x ? 0.22 : 0.11, calm);
      const moving = clear ? settle(s.across, restOf(s.question), dt, 0.13, calm) : false;

      draw();
      if (lifting || moving || s.want !== s.question) return true;
      // Nothing moves. Under the pointer, the pointer wakes it; otherwise sleep
      // until the tour's next question, or until the tour may take back over.
      if (calm || (s.steered !== null && root.current?.matches(":hover"))) return false;
      const wait = s.steered === null ? s.next - s.clock : Math.max(0, s.steered + RESUME - s.clock) + 0.05;
      nap.current?.for(Math.max(0.05, wait), (slept) => {
        state.current.clock += slept;
      });
      return false;
    },
    [draw],
  );

  const kick = useLoop(tick, inView);
  React.useEffect(() => {
    const sleeper = new Nap(kick);
    nap.current = sleeper;
    return () => sleeper.cancel();
  }, [kick]);

  // Draw once on mount and whenever the words change, so the readout is in the visitor's language.
  React.useLayoutEffect(() => {
    state.current.shown = "";
    state.current.drawn = "";
    draw();
  }, [draw]);

  const steer = (question: number) => {
    const s = state.current;
    s.steered = s.clock;
    if (question !== s.want) s.want = question;
    nap.current?.cancel();
    kick();
  };
  const onPointerLeave = () => {
    nap.current?.cancel();
    kick();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    const u = (event.clientX - box.left) / box.width;
    steer(Math.min(QUESTION_COUNT - 1, Math.max(0, Math.floor(u * QUESTION_COUNT))));
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    steer((state.current.want + 1) % QUESTION_COUNT);
  };

  return (
    <div className="iso lp-anatomy kn" ref={root} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown}>
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="kn-below">
            <path d={SCREW.below} />
          </clipPath>
          <clipPath id="kn-above">
            <path d={SCREW.above} />
          </clipPath>
        </defs>

        {BENCH_ART}
        <PostArt index={0} />
        {DRAWER_BACK}

        {STANDING.map((item) => {
          if (item.kind === "divider") {
            const divider = DIVIDER_ART.find((art) => art.x === item.x)!;
            return (
              <g key={`d${item.document}`}>
                <Solid paths={divider.body} tone="mid" crease="faint" />
                <Solid paths={divider.tab} tone="mid" crease="faint" />
                <Line d={divider.window} tone="lo" />
              </g>
            );
          }
          const index = item.card;
          const art = CARD_ART[index]!;
          const rank = rankOf(index, 0);
          return (
            <g
              className="kn-card"
              data-rank={rank}
              key={`c${index}`}
              ref={(node) => {
                cards.current[index] = node;
              }}
              transform={MOVE.up(riseOf(CARDS[index]!, 0, LIFT))}
            >
              <Solid paths={art.body} tone="hi" crease="faint" lit={rank === "best"} inner={<Line d={art.header} tone="mid" className="kn-text" />}>
                <Line d={art.text} tone="faint" className="kn-text" free />
              </Solid>
            </g>
          );
        })}

        {FOLLOWER_ART}
        {DRAWER_FRONT}

        <g ref={layer}>
          <g ref={arm} transform={MOVE.both(restOf(0), LIFT)}>
            <Solid paths={LIFTER.arm} tone="mid" crease="faint" />
            <Solid paths={LIFTER.boss} tone="mid" crease="faint" />
            <Solid paths={LIFTER.saddle} tone="hi" crease="faint" />
          </g>
          {STUB_ART.map((stub, index) => (
            <g
              className="kn-stub"
              data-on={index === 0 ? "" : undefined}
              key={stub.y}
              ref={(node) => {
                stubs.current[index] = node;
              }}
              transform={MOVE.up(index === 0 ? LIFT : 0)}
            >
              <Solid paths={stub.rod} tone="mid" crease="none" />
              <Solid paths={stub.nut} tone="mid" crease="faint" />
              <Line d={stub.nutFace} tone="lo" />
            </g>
          ))}
        </g>

        <PostArt index={1} />
        {BEAM_ART}

        <g ref={carriage} transform={MOVE.across(restOf(0))}>
          <g clipPath="url(#kn-below)">
            <g
              ref={(node) => {
                screws.current[0] = node;
              }}
              transform={MOVE.up(LIFT)}
            >
              {SCREW_ROD}
            </g>
          </g>
          <Solid paths={CARRIAGE_ART.block} tone="mid" crease="faint" />
          <Dots points={CARRIAGE_ART.screws} size={0.5} tone="mid" />
          <Solid paths={CARRIAGE_ART.finger} tone="hi" crease="none" />
          <Line d={CARRIAGE_ART.index} tone="hi" />
          <Solid paths={CARRIAGE_ART.nut} tone="mid" crease="faint" />
          <g clipPath="url(#kn-above)">
            <g
              ref={(node) => {
                screws.current[1] = node;
              }}
              transform={MOVE.up(LIFT)}
            >
              {SCREW_ROD}
              <Solid paths={SCREW.knob} tone="mid" crease="faint" inner={<Line d={SCREW.knobChamfers} tone="lo" />} />
              <Line d={SCREW.knobKnurl} tone="lo" />
              <Line d={SCREW.knobRing} tone="lo" />
            </g>
          </g>
        </g>
      </svg>

      <span className="lp-corner" data-corner="hint">
        <span className="lp-hover">{t("landing.capabilities.art.knowledge.hint")}</span>
        <span className="lp-touch">{t("landing.capabilities.art.knowledge.hintTouch")}</span>
      </span>
      <span className="lp-corner" data-corner="readout" ref={readout}>
        {resultOf(0)}
      </span>
    </div>
  );
}
