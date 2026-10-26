"use client";

import "@/components/iso/iso.css";
import "./anatomy.css";
import * as React from "react";
import { Dots, Line, Solid } from "@/components/iso/draw";
import { useInView, useLoop } from "@/components/iso/live";
import { useI18n } from "@/lib/i18n/provider";
import {
  BOARD_ART,
  GANTRY,
  HEIGHT,
  PIN_HOLES,
  PINS_PER_DAY,
  PIN_UP,
  Q,
  RAILS,
  RIDE,
  WIDTH,
  alongUp,
  blockOf,
  pinHole,
  pinOf,
  shift,
} from "./calendar-geometry";
import { BUSY, CHOICES, DAYS, LENGTH, QUARTERS, blocksAfter, clockOf, offered, type Block } from "./calendar-model";
import { LiveSolid, SmallSolid, paint, paintSmall, put, show } from "./live-solid";
import { Nap, settle, type Motion } from "./motion";

/**
 * Fig 05.4, "Calendar and bookings": a booking board with a go/no-go gauge.
 *
 * Each rail is a day in quarter hours, with the calendar's events standing in
 * it. The gantry carries one 30-minute feeler per day across the board; a
 * feeler drops wherever its length fits and rides over the blocks where it does
 * not, and each place it drops puts up a pin: a slot offered. Then the gantry
 * goes back to the slot the customer chose — it lights — and presses a new
 * block in: booked, and busy from then on. See `calendar-model.ts`.
 */

/** Seconds for each part of a search and booking, on the idle tour. */
const SWEEP = 4.4;
const RETURN = 1.1;
const PRESS = 0.7;
const HOLD = 2.2;
const REWIND = 1.2;
const CYCLE = SWEEP + RETURN + PRESS + HOLD + REWIND;
/** The gantry's travel, in quarters: from just before the first start to the last one. */
const FROM = -1;
const LAST = QUARTERS - LENGTH;
/** How high a feeler carries the new block before pressing it in. */
const CARRY = 2.6;

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

/** What a search finds, by how many bookings the week has: the week changes a handful of times, the frame sixty times a second. */
const OFFERS = Array.from({ length: CHOICES.length + 1 }, (_, searches) => offered(blocksAfter(searches)));
const offeredAfter = (searches: number) => OFFERS[searches] ?? OFFERS[0]!;

/** Where a pin that is down waits: deep enough below its hole that not even its head shows over the rim. */
const SUNK = -2.5;

/** A pin and its hole, built the first time that slot is offered and kept. */
const PINS = new Map<string, ReturnType<typeof pinOf> & ReturnType<typeof pinHole>>();
function pinParts(day: number, at: number) {
  const key = `${day} ${at}`;
  let parts = PINS.get(key);
  if (!parts) PINS.set(key, (parts = { ...pinOf(day, at), ...pinHole(day, at) }));
  return parts;
}

type Phase = "sweep" | "return" | "press" | "hold" | "rewind";

/** Where the tour stands at `clock` seconds into a cycle. */
function phaseAt(clock: number): { phase: Phase; progress: number } {
  let t = clock;
  for (const [phase, length] of [
    ["sweep", SWEEP],
    ["return", RETURN],
    ["press", PRESS],
    ["hold", HOLD],
    ["rewind", REWIND],
  ] as const) {
    if (t < length) return { phase, progress: t / length };
    t -= length;
  }
  return { phase: "rewind", progress: 1 };
}

type State = {
  clock: number;
  /** Searches finished: the calendar has that many bookings in it. */
  cycle: number;
  /** While the pointer steers: where it holds the gantry, in quarters. */
  steer: number | null;
  feelers: Motion[];
  gantry: number;
  shown: string;
  drawn: string;
};

export function CalendarFigure() {
  const { t } = useI18n();
  const uid = `cl${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const root = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const railGroups = React.useRef<(SVGGElement | null)[]>([]);
  const blockSlots = React.useRef<(SVGGElement | null)[][]>([]);
  const feet = React.useRef<(SVGGElement | null)[]>([]);
  const rods = React.useRef<(SVGGElement | null)[]>([]);
  const pins = React.useRef<(SVGGElement | null)[]>([]);
  const gantry = React.useRef<SVGGElement>(null);
  const gantryFront = React.useRef<SVGGElement>(null);
  const booking = React.useRef<SVGGElement | null>(null);
  const bookingRules = React.useRef<SVGPathElement>(null);
  const inView = useInView(root);

  const state = React.useRef<State>({
    clock: 0.6,
    cycle: 0,
    steer: null,
    feelers: Array.from({ length: DAYS }, () => ({ x: 0, v: 0 })),
    gantry: FROM,
    shown: "",
    drawn: "",
  });

  const words = React.useMemo(
    () => ({
      checking: (count: number) => t("landing.capabilities.art.calendar.checking", { count }),
      booking: t("landing.capabilities.art.calendar.pending"),
      booked: (day: number, at: number) => t("landing.capabilities.art.calendar.booked", { day: t(`landing.capabilities.art.calendar.weekday.${day}`), time: clockOf(at) }),
    }),
    [t],
  );

  const draw = React.useCallback(() => {
    const s = state.current;
    const searches = s.cycle % (CHOICES.length + 1);
    const done = searches === CHOICES.length;
    const blocks = blocksAfter(searches);
    const choice = done ? null : CHOICES[searches]!;
    const { phase, progress } = s.steer !== null ? { phase: "sweep" as Phase, progress: 0 } : phaseAt(s.clock);
    const at = s.gantry;

    // The calendar's blocks, rail by rail, only when the week changes.
    const week = `${searches}`;
    if (week !== s.drawn) {
      s.drawn = week;
      for (let day = 0; day < DAYS; day++) {
        const mine = blocks.filter((block) => block.day === day).sort((a, b) => a.from - b.from);
        blockSlots.current[day]?.forEach((slot, index) => {
          const block = mine[index];
          if (!slot) return;
          if (!block) {
            slot.setAttribute("display", "none");
            return;
          }
          slot.removeAttribute("display");
          slot.setAttribute("data-from", String(block.from));
          const shape = blockOf(block);
          paint(slot.children[0], shape.paths);
          slot.children[1]?.setAttribute("d", shape.rules);
          // A block booked by an earlier search keeps the subject's ink; the calendar's own are structure.
          slot.children[0]?.querySelector(".iso-edge")?.setAttribute("data-tone", BUSY.includes(block) ? "mid" : "hi");
        });
      }
    }

    // The gantry, and each feeler riding over what is under it.
    const along = shift([at * Q, 0, 0]);
    put(gantry.current, "transform", along);
    put(gantryFront.current, "transform", along);
    for (let day = 0; day < DAYS; day++) {
      const lift = s.feelers[day]!.x;
      const carrying = choice && day === choice.day && phase !== "sweep";
      put(feet.current[day], "transform", alongUp(at, lift));
      put(rods.current[day], "transform", shift([0, 0, lift]));
      // The foot goes in among the blocks by where it stands, so it passes in front of the ones behind it.
      const group = railGroups.current[day];
      const foot = feet.current[day];
      if (group && foot) {
        const slots = (blockSlots.current[day] ?? []).filter((slot): slot is SVGGElement => !!slot && !slot.hasAttribute("display"));
        const after = slots.find((slot) => Number(slot.getAttribute("data-from")) * Q > at * Q + 0.5) ?? group.querySelector(".cl-front");
        if (after && foot.nextSibling !== after) group.insertBefore(foot, after);
        if (carrying && booking.current) {
          if (booking.current.parentNode !== group || booking.current.nextSibling !== foot) group.insertBefore(booking.current, foot);
        }
      }
    }

    // The new block: it appears under the feeler on the way back, is pressed in, and stays.
    if (booking.current) {
      if (choice && phase !== "sweep") {
        show(booking.current, true);
        const grow = phase === "return" ? smooth(progress / 0.5) : 1;
        const shape = blockOf({ day: choice.day, from: choice.at, to: choice.at + LENGTH });
        paint(booking.current.children[0], shape.paths);
        put(bookingRules.current, "d", shape.rules);
        const carried = phase === "return" || phase === "press" ? Math.max(0, s.feelers[choice.day]!.x - RIDE) : 0;
        put(booking.current, "transform", shift([0, 0, carried]));
        put(booking.current, "opacity", grow.toFixed(3));
        put(booking.current.firstElementChild, "data-lit", phase !== "rewind" ? "" : null);
      } else show(booking.current, false);
    }

    // Pins: every slot the gauge has passed and found free, up; the chosen one
    // lit. Each is drawn whole at its hole once and rises by a translate; one
    // that is down sinks out of sight below its hole's rim rather than leaving
    // the page, so pins coming and going never rebuild the drawing's layout.
    const slots = offeredAfter(searches);
    const sweepAt = phase === "sweep" ? at : LAST + 1;
    const fall = phase === "rewind" ? 1 - smooth(progress * 1.6) : 1;
    let shown = 0;
    for (let day = 0; day < DAYS; day++) {
      const mine = slots.filter((slot) => slot.day === day);
      for (let index = 0; index < PINS_PER_DAY; index++) {
        const node = pins.current[day * PINS_PER_DAY + index];
        const slot = mine[index];
        if (!node) continue;
        const height = slot ? PIN_UP * smooth((sweepAt - slot.at) / 0.8) * fall : 0;
        const [clip, cut, rim] = Array.from(node.children);
        const moving = cut?.firstElementChild;
        if (slot) {
          const hole = pinParts(slot.day, slot.at);
          put(clip?.firstElementChild, "d", hole.clip);
          paintSmall(moving?.children[0], hole.shank);
          paintSmall(moving?.children[1], hole.head);
          put(rim, "d", height > 0.02 ? hole.rim : "");
          show(node, true);
        }
        if (height >= PIN_UP * 0.5) shown++;
        put(moving, "transform", shift([0, 0, (height > 0.02 ? height : SUNK) - PIN_UP]));
        put(moving?.children[1], "data-lit", !!choice && slot?.day === choice.day && slot?.at === choice.at && phase !== "sweep" ? "" : null);
      }
    }

    const text =
      phase === "sweep" || !choice
        ? words.checking(phase === "sweep" ? shown : slots.length)
        : phase === "return"
          ? words.booking
          : words.booked(choice.day, choice.at);
    if (text !== s.shown && readout.current) {
      readout.current.textContent = text;
      s.shown = text;
    }
  }, [words]);

  const nap = React.useRef<Nap | null>(null);
  const tick = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      if (s.steer === null) {
        s.clock += calm ? 0 : dt;
        if (s.clock >= CYCLE) {
          s.clock -= CYCLE;
          s.cycle++;
        }
      }
      if (calm && s.steer === null) s.clock = SWEEP + RETURN + PRESS + HOLD / 2;
      const searches = s.cycle % (CHOICES.length + 1);
      const choice = CHOICES[searches] ?? null;
      const { phase, progress } = phaseAt(s.clock);
      // Once it is pressed in, the new block is under the feelers like any other.
      const pressed = choice && (phase === "hold" || phase === "rewind" || (phase === "press" && progress > 0.7));
      const blocks: Block[] = [...blocksAfter(searches), ...(pressed && choice ? [{ day: choice.day, from: choice.at, to: choice.at + LENGTH }] : [])];

      // Where the gantry is: steered by the pointer, or by the tour.
      let target: number;
      if (s.steer !== null) target = s.steer;
      else if (phase === "sweep") target = FROM + (LAST - FROM) * progress;
      else if (phase === "rewind") target = choice ? choice.at + (FROM - choice.at) * smooth(progress) : FROM;
      else target = choice ? choice.at : LAST;
      if (phase === "return" && s.steer === null && choice) target = LAST + (choice.at - LAST) * smooth(progress);
      s.gantry = calm ? target : s.gantry + (target - s.gantry) * (1 - Math.exp(-dt / (s.steer !== null ? 0.12 : 0.04)));

      // Each feeler: down where an appointment fits under its foot, up over any block, a little ahead of time.
      let still = true;
      for (let day = 0; day < DAYS; day++) {
        const lead = 0.35;
        const from = s.gantry - lead;
        const to = s.gantry + LENGTH + lead;
        const blocked = blocks.some((block) => block.day === day && block.from < to && block.to > from);
        let lift = blocked ? RIDE : 0;
        if (choice && day === choice.day && s.steer === null) {
          if (phase === "return") lift = Math.max(lift, RIDE + CARRY);
          else if (phase === "press") lift = RIDE + CARRY * (1 - smooth(progress * 1.4));
        }
        if (settle(s.feelers[day]!, lift, dt, 0.05, calm)) still = false;
      }
      draw();
      if (calm || !still || Math.abs(target - s.gantry) > 5e-3) return !calm;
      // Nothing moves: under the pointer, the pointer wakes it; while the booking
      // is held, sleep until the tour lets the pins down.
      if (s.steer !== null) return false;
      if (phase === "hold") {
        nap.current?.for(Math.max(0.02, (1 - progress) * HOLD), (slept) => {
          state.current.clock += slept;
        });
        return false;
      }
      return true;
    },
    [draw],
  );

  const kick = useLoop(tick, inView);
  React.useEffect(() => {
    const sleeper = new Nap(kick);
    nap.current = sleeper;
    return () => sleeper.cancel();
  }, [kick]);

  React.useLayoutEffect(() => {
    state.current.shown = "";
    state.current.drawn = "";
    draw();
  }, [draw]);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const s = state.current;
    if (s.steer === null) {
      // Steering starts a fresh search of the same week.
      s.clock = 0;
    }
    s.steer = FROM + (LAST - FROM) * u;
    nap.current?.cancel();
    kick();
  };
  const onPointerLeave = () => {
    const s = state.current;
    if (s.steer === null) return;
    // Pick up the tour from where the pointer left the gantry.
    s.clock = Math.min(SWEEP - 0.01, Math.max(0, ((s.steer - FROM) / (LAST - FROM)) * SWEEP));
    s.steer = null;
    nap.current?.cancel();
    kick();
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    const s = state.current;
    s.clock = phaseAt(s.clock).phase === "sweep" ? SWEEP : 0;
    if (s.clock === 0) s.cycle++;
    nap.current?.cancel();
    kick();
  };

  return (
    <div className="iso lp-anatomy cl" ref={root} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown}>
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        <path className="iso-halo" d={BOARD_ART.halo} />
        {BOARD_ART.feet.map((parts, index) => (
          <g key={index}>
            {parts.map((paths, part) => (
              <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} crease="faint" />
            ))}
          </g>
        ))}
        <Solid paths={BOARD_ART.bench} tone="mid" crease="faint" />
        <Line d={BOARD_ART.groove} tone="faint" />
        <Line d={BOARD_ART.screwRings} tone="lo" />
        <Dots points={BOARD_ART.screws} size={0.55} tone="mid" />

        {/* The back guide and its carriage and upright, behind the board. */}
        <Solid paths={GANTRY.guides[0]!.rail} tone="mid" crease="faint" inner={<Line d={GANTRY.guides[0]!.seam} tone="faint" />} />
        {GANTRY.guides[0]!.stops.map((paths, index) => (
          <Solid key={index} paths={paths} tone="mid" crease="faint" />
        ))}
        <g ref={gantry}>
          <Solid paths={GANTRY.carriages[0]!} tone="mid" crease="faint" />
          <Dots points={GANTRY.carriageScrews[0]!} size={0.45} tone="mid" />
          <Solid paths={GANTRY.uprights[0]!} tone="mid" crease="none" inner={<Line d={GANTRY.upSeams[0]!} tone="faint" />} />
        </g>

        <Solid paths={BOARD_ART.board} tone="mid" crease="faint" />
        <Dots points={BOARD_ART.boardScrews} size={0.45} tone="mid" />
        <Line d={PIN_HOLES} tone="faint" />
        <Solid paths={BOARD_ART.label} tone="lo" crease="none" />
        <Line d={BOARD_ART.labelLine} tone="faint" />
        <Line d={BOARD_ART.labelRules} tone="lo" free />
        <Dots points={BOARD_ART.labelScrews} size={0.4} tone="mid" />

        {RAILS.map((rail) => (
          <g
            key={rail.day}
            ref={(node) => {
              railGroups.current[rail.day] = node;
            }}
          >
            <Solid paths={rail.tab} tone="lo" crease="none" />
            <Line d={rail.tabLine} tone="faint" />
            <Line d={rail.tabRule} tone="lo" free />
            {Array.from({ length: PINS_PER_DAY }, (_, index) => {
              const clip = `${uid}-pin-${rail.day}-${index}`;
              return (
                <g
                  className="cl-pin"
                  display="none"
                  key={index}
                  ref={(node) => {
                    pins.current[rail.day * PINS_PER_DAY + index] = node;
                  }}
                >
                  <clipPath id={clip}>
                    <path />
                  </clipPath>
                  <g clipPath={`url(#${clip})`}>
                    <g>
                      <SmallSolid refer={() => {}} />
                      <SmallSolid refer={() => {}} />
                    </g>
                  </g>
                  <path className="iso-line" data-tone="lo" />
                </g>
              );
            })}
            <Solid paths={rail.ends[0]!} tone="mid" crease="faint" />
            <Solid paths={rail.back} tone="mid" crease="faint" />
            <Line d={rail.ticks.minor} tone="faint" />
            <Line d={rail.ticks.major} tone="lo" />
            {Array.from({ length: 8 }, (_, index) => (
              <g
                className="cl-block"
                key={index}
                display="none"
                ref={(node) => {
                  (blockSlots.current[rail.day] ??= [])[index] = node;
                }}
              >
                <LiveSolid refer={() => {}} />
                <path className="iso-line" data-free="" data-tone="lo" />
              </g>
            ))}
            <g
              ref={(node) => {
                feet.current[rail.day] = node;
              }}
            >
              <Solid paths={GANTRY.feelers[rail.day]!.foot} tone="hi" crease="faint" />
            </g>
            <g className="cl-front">
              <Solid paths={rail.front} tone="mid" crease="faint" />
              <Solid paths={rail.ends[1]!} tone="mid" crease="faint" />
              <Dots points={rail.endScrews} size={0.35} tone="mid" />
            </g>

          </g>
        ))}
        <g display="none" ref={(node) => { booking.current = node; }}>
          <LiveSolid lit refer={() => {}} />
          <path className="iso-line" data-free="" data-tone="lit" ref={bookingRules} />
        </g>

        <Solid paths={BOARD_ART.ruler} tone="lo" crease="none" />
        <Line d={BOARD_ART.rulerMinor} tone="lo" />
        <Line d={BOARD_ART.rulerMajor} tone="mid" />

        <Solid paths={GANTRY.guides[1]!.rail} tone="mid" crease="faint" inner={<Line d={GANTRY.guides[1]!.seam} tone="faint" />} />
        {GANTRY.guides[1]!.stops.map((paths, index) => (
          <Solid key={index} paths={paths} tone="mid" crease="faint" />
        ))}
        <g ref={gantryFront}>
          <Solid paths={GANTRY.carriages[1]!} tone="mid" crease="faint" />
          <Dots points={GANTRY.carriageScrews[1]!} size={0.45} tone="mid" />
          <Solid paths={GANTRY.uprights[1]!} tone="mid" crease="none" inner={<Line d={GANTRY.upSeams[1]!} tone="faint" />} />
          <Solid paths={GANTRY.beam} tone="mid" crease="faint" />
          <Dots points={GANTRY.beamScrews} size={0.5} tone="mid" />
          {GANTRY.feelers.map((feeler, day) => (
            <g
              key={day}
              ref={(node) => {
                rods.current[day] = node;
              }}
            >
              <Solid paths={feeler.rod} tone="mid" crease="none" />
              <Solid paths={feeler.cap} tone="mid" crease="faint" />
            </g>
          ))}
          {GANTRY.bushings.map((paths, day) => (
            <Solid key={day} paths={paths} tone="mid" crease="faint" />
          ))}
        </g>
      </svg>

      <span className="lp-corner" data-corner="hint">
        <span className="lp-hover">{t("landing.capabilities.art.calendar.hint")}</span>
        <span className="lp-touch">{t("landing.capabilities.art.calendar.hintTouch")}</span>
      </span>
      <span className="lp-corner" data-corner="readout" ref={readout} />
    </div>
  );
}
