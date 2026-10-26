"use client";

import "@/components/iso/iso.css";
import "./anatomy.css";
import * as React from "react";
import { Dots, Line, Solid } from "@/components/iso/draw";
import { useInView, useLoop } from "@/components/iso/live";
import { useI18n } from "@/lib/i18n/provider";
import {
  BENCH,
  CRANK_ART,
  DRUM_ART,
  GEAR,
  GEAR_TEETH,
  HEAD_X,
  HEIGHT,
  LANES,
  LIMITS,
  MESH,
  MOTOR_ART,
  PACK,
  PHASES,
  PIVOT_ART,
  PRINTER,
  SPAN,
  STATION_ART,
  SUPPLY_ART,
  TAPE,
  WIDTH,
  crankArm,
  flag,
  flangeHoles,
  gearHoles,
  liftsAt,
  meshPhase,
  pinionAngle,
  rocker,
  tapeLine,
  up,
} from "./handoff-geometry";
import { ACK, GAP, SPEED, Tape, linesOf, type Owner } from "./handoff-model";
import { Cable } from "./cable";
import { LiveSolid, paint, put } from "./live-solid";
import { Nap, settle, type Motion } from "./motion";

/**
 * Fig 05.2, "Hand off to a person": a tape transport with a manual override.
 *
 * The tape is the conversation. The customer's messages come in printed on
 * its upper lane; while the agent owns it, a motor runs the tape and the head
 * prints a reply under each message as it passes. Hand it off and the head
 * prints one short acknowledgement, the rocker lifts the motor's pinion out of
 * the gear and lowers the crank's in, the flag goes up and the note card —
 * what they asked — is lit. One rocker carries both pinions, so the gear only
 * ever has one driver: a person owns the conversation until they hand it back.
 * See `handoff-model.ts`.
 */

const { LIFT, TILT } = LIMITS;
/** Seconds the idle tour leaves each owner in charge. */
const DWELL: Readonly<Record<Owner, number>> = { agent: 5.6, person: 4.4 };
/** Seconds after the pointer leaves before the tour takes over again. */
const RESUME = 3.6;
/** How far the tape runs after the acknowledgement starts: it, and clear of the head. */
const ACK_RUN = ACK + 4.6;
/** Message and reply blocks, and how long their lines run. */
const MESSAGE = { width: 10, long: 9.5, short: 6.5 } as const;
const REPLY = { width: 11, long: 10.5, short: 7.5 } as const;
/** Lines kept ready on the tape: two per message and two per reply in view. */
const POOL = 20;
const FADE = 6;
/** Where the crank's arm points at rest: off to the right, clear of the rocker's handle. */
const ARM_REST = (-25 * Math.PI) / 180;

type Stage = "run" | "ack";

type State = {
  owner: Owner;
  want: Owner;
  stage: Stage;
  /** Where the acknowledgement ends on the tape, while it is being printed. */
  ackEnd: number;
  tape: Tape;
  tilt: Motion;
  raise: Motion;
  /** The motor's own speed, as tape it would run a second. */
  motor: number;
  /** Each pinion's turn, in teeth: unwrapped, so an arm never jumps a tooth. */
  motorTeeth: number;
  crankTeeth: number;
  clock: number;
  steered: number | null;
  next: number;
  shown: string;
  drawn: Record<string, string>;
};

const frac = (value: number) => ((value % 1) + 1) % 1;
const phaseIndex = (teeth: number) => Math.floor(frac(teeth) * PHASES) % PHASES;
const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
/** The gear's turn, in teeth, for tape travelled: the drum winds the tape at the pack's radius. */
const gearTeeth = (travelled: number) => (-travelled / PACK) * (GEAR_TEETH / (Math.PI * 2));
/** Nearest unwrapped value to `from` that has the fractional part of `target`. */
const nearest = (from: number, target: number) => from + (frac(target - from + 0.5) - 0.5);

// ── the static art, in painter's order ──────────────────────────────────

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
    <Solid paths={BENCH.label} tone="lo" crease="none" />
    <Line d={BENCH.labelLine} tone="faint" />
    <Line d={BENCH.labelRules} tone="lo" free />
    <Dots points={BENCH.labelScrews} size={0.45} tone="mid" />
    <Solid paths={BENCH.socket} tone="mid" crease="faint" />
    <Cable points={MOTOR_ART.cable} radius={2.4} />
    <Solid paths={MOTOR_ART.plug} tone="mid" crease="faint" />
  </g>
);

/** A spool up to its wound tape. Its upper flange is drawn after the tape, which runs under its rim. */
function SpoolBase({ art }: { art: typeof SUPPLY_ART }) {
  return (
    <g>
      <Solid paths={art.pillow} tone="lo" crease="faint" />
      <Dots points={art.pillowScrews} size={0.45} tone="mid" />
      <Solid paths={art.boss} tone="mid" crease="none" />
      <Solid paths={art.lower} tone="mid" crease="faint" />
      <Solid paths={art.pack} tone="hi" crease="none" inner={<Line d={art.windings} tone="faint" />} />
    </g>
  );
}

const PRINTER_BACK = (
  <g key="platen">
    <Solid paths={PRINTER.platenFoot} tone="lo" crease="faint" />
    <Solid paths={PRINTER.platen} tone="mid" crease="faint" />
  </g>
);

const PRINTER_FRONT = (
  <g key="head">
    <Solid paths={PRINTER.foot} tone="lo" crease="faint" />
    <Dots points={PRINTER.footScrews} size={0.45} tone="mid" />
    <Solid paths={PRINTER.post} tone="mid" crease="none" />
    <Solid paths={PRINTER.hammer} tone="mid" crease="none" />
    <Solid paths={PRINTER.head} tone="mid" crease="faint" />
    <Dots points={PRINTER.headScrews} size={0.45} tone="mid" />
    <Solid paths={PRINTER.ribbon} tone="mid" crease="faint" />
    {PRINTER.ribbonSpools.map((d, index) => (
      <Line d={d} key={index} tone="lo" />
    ))}
  </g>
);

const MOTOR_BODY = (
  <g key="motor">
    <Solid paths={MOTOR_ART.cradle} tone="lo" crease="faint" />
    <Dots points={MOTOR_ART.cradleScrews} size={0.45} tone="mid" />
    <Solid paths={MOTOR_ART.can} tone="mid" crease="none" inner={<Line d={MOTOR_ART.finSeams} tone="lo" />} />
    <Line d={MOTOR_ART.fins} tone="lo" />
    <Solid paths={MOTOR_ART.box} tone="mid" crease="faint" />
    <Dots points={MOTOR_ART.boxScrews} size={0.4} tone="mid" />
    <Solid paths={MOTOR_ART.gland} tone="mid" crease="none" />
    <Solid paths={MOTOR_ART.bell} tone="mid" crease="faint" />
    <Solid paths={MOTOR_ART.boss} tone="mid" crease="none" />
    <Solid paths={MOTOR_ART.shaft} tone="mid" crease="none" />
  </g>
);

const CRANK_BODY = (
  <g key="crank">
    <Solid paths={CRANK_ART.flange} tone="lo" crease="faint" />
    <Dots points={CRANK_ART.flangeScrews} size={0.45} tone="mid" />
    <Solid paths={CRANK_ART.tube} tone="mid" crease="none" inner={<Line d={CRANK_ART.tubeSeam} tone="faint" />} />
    <Solid paths={CRANK_ART.bearing} tone="mid" crease="faint" />
    <Solid paths={CRANK_ART.shaft} tone="mid" crease="none" />
  </g>
);

const PIVOT_BODY = (
  <g key="pivot">
    <Solid paths={PIVOT_ART.foot} tone="lo" crease="faint" />
    <Dots points={PIVOT_ART.footScrews} size={0.4} tone="mid" />
    <Solid paths={PIVOT_ART.post} tone="mid" crease="none" inner={<Line d={PIVOT_ART.seams} tone="faint" />} />
    <Solid paths={PIVOT_ART.yoke} tone="mid" crease="faint" />
  </g>
);

const STATION_BODY = (
  <g key="station">
    <Solid paths={STATION_ART.base} tone="lo" crease="faint" />
    <Dots points={STATION_ART.screws} size={0.45} tone="mid" />
    <Solid paths={STATION_ART.flagPost} tone="mid" crease="none" />
    <Solid paths={STATION_ART.holder} tone="mid" crease="faint" />
  </g>
);

// ── the live figure ─────────────────────────────────────────────────────

export function HandoffFigure() {
  const { t } = useI18n();
  const root = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const gear = React.useRef<SVGGElement | null>(null);
  const gearHoleLine = React.useRef<SVGPathElement>(null);
  const supplyHoleLine = React.useRef<SVGPathElement>(null);
  const motorPinion = React.useRef<SVGGElement | null>(null);
  const crankPinion = React.useRef<SVGGElement | null>(null);
  const motorLow = React.useRef<SVGGElement>(null);
  const motorHigh = React.useRef<SVGGElement>(null);
  const crankLow = React.useRef<SVGGElement>(null);
  const crankHigh = React.useRef<SVGGElement>(null);
  const arm = React.useRef<(SVGGElement | null)[]>([]);
  const lever = React.useRef<(SVGGElement | null)[]>([]);
  const pin = React.useRef<SVGCircleElement>(null);
  const flagParts = React.useRef<(SVGGElement | null)[]>([]);
  const card = React.useRef<SVGGElement>(null);
  const marks = React.useRef<(SVGPathElement | null)[]>([]);
  const ack = React.useRef<SVGPathElement>(null);
  const inView = useInView(root);

  const state = React.useRef<State>({
    owner: "agent",
    want: "agent",
    stage: "run",
    ackEnd: 0,
    tape: new Tape(),
    tilt: { x: TILT, v: 0 },
    raise: { x: 0, v: 0 },
    motor: SPEED,
    motorTeeth: 0,
    crankTeeth: 0,
    clock: 0,
    steered: null,
    next: DWELL.agent,
    shown: "",
    drawn: {},
  });

  const words = React.useMemo(
    () => ({
      replying: (count: number) => t("landing.capabilities.art.handoff.replying", { count }),
      handing: t("landing.capabilities.art.handoff.handing"),
      waiting: t("landing.capabilities.art.handoff.waiting", { note: t("landing.capabilities.art.handoff.note") }),
    }),
    [t],
  );

  /** Writes every moving part from the state. */
  const draw = React.useCallback(() => {
    /** Writes `value` to a part only when it changed since the last frame. */
    const once = (key: string, value: string, write: () => void) => {
      const drawn = state.current.drawn;
      if (drawn[key] === value) return;
      drawn[key] = value;
      write();
    };

    /** The tape's print, from the model: the customer's messages, the replies, the acknowledgement. */
    const drawTape = (travelled: number) => {
      const lines: { x0: number; x1: number; z: number; tone: string }[] = [];
      const place = (u0: number, u1: number, z: number, tone: string) => {
        const x0 = HEAD_X + travelled - u1;
        const x1 = HEAD_X + travelled - u0;
        if (x1 <= SPAN.from || x0 >= SPAN.to || x1 - x0 < 0.05) return;
        lines.push({ x0: Math.max(SPAN.from, x0), x1: Math.min(SPAN.to, x1), z, tone });
      };
      const first = Math.floor((travelled - (SPAN.to - HEAD_X) - MESSAGE.width) / GAP);
      const last = Math.ceil((travelled + (HEAD_X - SPAN.from)) / GAP);
      for (let message = first; message <= last; message++) {
        const start = message * GAP;
        const [long, short] = linesOf(message, MESSAGE.long, MESSAGE.short);
        place(start + MESSAGE.width - long, start + MESSAGE.width, LANES.customer[0], "lo");
        place(start + MESSAGE.width - short, start + MESSAGE.width, LANES.customer[1], "lo");
      }
      let ackLine = "";
      for (const mark of state.current.tape.printed) {
        if (mark.kind === "ack") {
          const end = Math.min(mark.at + ACK, travelled);
          if (end > mark.at) {
            const x0 = HEAD_X + travelled - end;
            const x1 = HEAD_X + travelled - mark.at;
            if (x1 > SPAN.from && x0 < SPAN.to) ackLine = tapeLine(Math.max(SPAN.from, x0), Math.min(SPAN.to, x1), LANES.ack);
          }
          continue;
        }
        const [long, short] = linesOf(mark.message + 1000, REPLY.long, REPLY.short);
        const right = mark.at + REPLY.width;
        place(right - long, Math.min(right, travelled), LANES.agent[0], "mid");
        place(right - short, Math.min(right, travelled), LANES.agent[1], "mid");
      }
      marks.current.forEach((node, index) => {
        const line = lines[index];
        if (!node) return;
        if (!line) {
          put(node, "d", "");
          return;
        }
        const fade = Math.min(smooth((line.x0 - SPAN.from) / FADE), smooth((SPAN.to - line.x1) / FADE));
        put(node, "d", tapeLine(line.x0, line.x1, line.z));
        put(node, "data-tone", line.tone);
        put(node, "stroke-opacity", fade.toFixed(2));
      });
      put(ack.current, "d", ackLine);
    };

    const s = state.current;
    const travelled = s.tape.travelled;
    const teeth = gearTeeth(travelled);
    const tilt = s.tilt.x;
    const lifts = liftsAt(tilt);

    once("tape", travelled.toFixed(3), () => {
      drawTape(travelled);
      const angle = -travelled / PACK;
      put(gearHoleLine.current, "d", gearHoles(angle));
      put(supplyHoleLine.current, "d", flangeHoles(SUPPLY_ART.centre, angle));
    });
    once("gear", String(phaseIndex(teeth)), () => paint(gear.current, GEAR.phases[phaseIndex(teeth)]!));
    once("motor", String(phaseIndex(s.motorTeeth)), () => paint(motorPinion.current, MOTOR_ART.pinion.phases[phaseIndex(s.motorTeeth)]!));
    once("crank", String(phaseIndex(s.crankTeeth)), () => paint(crankPinion.current, CRANK_ART.pinion.phases[phaseIndex(s.crankTeeth)]!));
    once("arm", s.crankTeeth.toFixed(3), () => {
      const parts = crankArm(pinionAngle(s.crankTeeth) + ARM_REST);
      [parts.hub, parts.arm, parts.boss, parts.grip, parts.knob].forEach((paths, index) => paint(arm.current[index], paths));
    });
    once("lift", tilt.toFixed(4), () => {
      const motorUp = up(lifts.motor);
      const crankUp = up(lifts.crank);
      motorLow.current?.setAttribute("transform", motorUp);
      motorHigh.current?.setAttribute("transform", motorUp);
      crankLow.current?.setAttribute("transform", crankUp);
      crankHigh.current?.setAttribute("transform", crankUp);
      const parts = rocker(tilt);
      [parts.bar, parts.motorEye, parts.crankEye, parts.grip, parts.knob].forEach((paths, index) => paint(lever.current[index], paths));
      pin.current?.setAttribute("cx", parts.pin[0].toFixed(1));
      pin.current?.setAttribute("cy", parts.pin[1].toFixed(1));
    });
    once("flag", s.raise.x.toFixed(4), () => {
      const parts = flag(s.raise.x);
      paint(flagParts.current[0], parts.arm);
      paint(flagParts.current[1], parts.plate);
    });
    const waiting = s.owner === "person" && s.stage === "run";
    once("lit", String(waiting), () => card.current?.firstElementChild?.toggleAttribute("data-lit", waiting));

    const text = s.stage === "ack" ? words.handing : waiting ? words.waiting : words.replying(s.tape.replies);
    if (text !== s.shown && readout.current) {
      readout.current.textContent = text;
      s.shown = text;
    }
  }, [words]);

  const nap = React.useRef<Nap | null>(null);
  const tick = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      s.clock += dt;

      // The tour, unless a visitor is steering.
      if (calm) s.next = Number.POSITIVE_INFINITY;
      else if (s.steered === null && s.clock >= s.next) {
        s.want = s.want === "agent" ? "person" : "agent";
        s.next = s.clock + DWELL[s.want];
      } else if (s.steered !== null && s.clock - s.steered > RESUME && !root.current?.matches(":hover")) {
        s.steered = null;
        s.next = s.clock + 1.6;
      }

      // Handing off: the agent's one acknowledgement goes out on the motor's last run, then the rocker throws.
      if (s.want === "person" && s.owner === "agent" && s.stage === "run") {
        s.ackEnd = s.tape.handOff();
        s.stage = "ack";
      }
      if (s.stage === "ack" && (calm || s.tape.travelled >= s.ackEnd + ACK_RUN - ACK)) {
        if (calm) s.tape.run(Math.max(0, s.ackEnd + ACK_RUN - ACK - s.tape.travelled), "person");
        s.owner = "person";
        s.stage = "run";
      }
      // Handing back is the person's call, and it takes nothing but the throw.
      if (s.want === "agent" && s.owner === "person") s.owner = "agent";

      const tilting = settle(s.tilt, s.owner === "agent" ? TILT : -TILT, dt, 0.16, calm);
      const raising = settle(s.raise, s.owner === "person" && s.stage === "run" ? 1 : 0, dt, 0.18, calm);
      const lifts = liftsAt(s.tilt.x);
      const motorIn = lifts.motor < 0.25;
      const crankIn = lifts.crank < 0.25;

      // The motor runs while it owns the conversation and is in mesh, spinning up and down rather than snapping.
      const driving = !calm && motorIn && (s.stage === "ack" || s.owner === "agent");
      const target = driving ? SPEED : 0;
      s.motor += (target - s.motor) * (1 - Math.exp(-dt / (target > s.motor ? 0.3 : 0.45)));
      if (Math.abs(target - s.motor) < 0.01) s.motor = target;
      if (calm) s.motor = 0;

      const before = s.tape.travelled;
      if (motorIn && s.motor > 0) s.tape.run(s.motor * dt, s.stage === "run" && s.owner === "agent" ? "agent" : "person");
      const gear = gearTeeth(s.tape.travelled);
      const moved = s.tape.travelled !== before;

      // Pinions in mesh turn with the gear; one out of mesh coasts (the motor) or holds (the crank), and eases into mesh as it drops.
      const motorMesh = meshPhase(gear, MESH.motor);
      if (motorIn) s.motorTeeth = nearest(s.motorTeeth, motorMesh);
      else if (lifts.motor < LIFT * 0.8) s.motorTeeth += (nearest(s.motorTeeth, motorMesh) - s.motorTeeth) * (1 - Math.exp(-dt / 0.08));
      else s.motorTeeth += (s.motor / PACK) * (GEAR_TEETH / (Math.PI * 2)) * dt;
      const crankMesh = meshPhase(gear, MESH.crank);
      if (crankIn) s.crankTeeth = nearest(s.crankTeeth, crankMesh);
      else if (lifts.crank < LIFT * 0.8 && s.owner === "person") s.crankTeeth += (nearest(s.crankTeeth, crankMesh) - s.crankTeeth) * (1 - Math.exp(-dt / 0.08));

      draw();
      const spinning = s.motor > 0;
      if (tilting || raising || spinning || moved || s.stage === "ack") return true;
      // A person holds the conversation and nothing turns: sleep until the
      // tour hands it back, or, under the pointer, until the pointer moves.
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

  React.useLayoutEffect(() => {
    state.current.shown = "";
    state.current.drawn = {};
    draw();
  }, [draw]);

  const steer = (owner: Owner) => {
    const s = state.current;
    s.steered = s.clock;
    s.want = owner;
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
    steer((event.clientX - box.left) / box.width > 0.5 ? "person" : "agent");
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    steer(state.current.want === "agent" ? "person" : "agent");
  };

  return (
    <div className="iso lp-anatomy ho" ref={root} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown}>
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        {BENCH_ART}

        <SpoolBase art={SUPPLY_ART} />
        {PRINTER_BACK}
        <SpoolBase art={DRUM_ART} />

        <g className="ho-tape">
          <Solid paths={TAPE} tone="hi" crease="faint" />
          {Array.from({ length: POOL }, (_, index) => (
            <path
              className="iso-line"
              data-free=""
              data-tone="lo"
              key={index}
              ref={(node) => {
                marks.current[index] = node;
              }}
            />
          ))}
          <path className="iso-line" data-free="" data-tone="hi" ref={ack} />
        </g>

        <Solid paths={SUPPLY_ART.upper} tone="mid" crease="faint" />
        <Solid paths={SUPPLY_ART.hub} tone="mid" crease="faint" />
        <path className="iso-line" data-tone="lo" ref={supplyHoleLine} />
        <Solid paths={DRUM_ART.upper} tone="mid" crease="faint" />
        <Solid paths={DRUM_ART.hub} tone="mid" crease="none" />

        {PRINTER_FRONT}

        <LiveSolid
          refer={(node) => {
            gear.current = node;
          }}
        />
        <path className="iso-line" data-tone="lo" ref={gearHoleLine} />
        <Solid paths={GEAR.cap} tone="mid" crease="faint" />
        <Line d={GEAR.capRing} tone="lo" />

        {MOTOR_BODY}
        {CRANK_BODY}
        {PIVOT_BODY}

        <g ref={motorLow}>
          <LiveSolid
            refer={(node) => {
              motorPinion.current = node;
            }}
          />
          <Solid paths={MOTOR_ART.pinion.collar} tone="mid" crease="faint" />
        </g>
        <g ref={crankLow}>
          <LiveSolid
            refer={(node) => {
              crankPinion.current = node;
            }}
          />
          <Solid paths={CRANK_ART.pinion.collar} tone="mid" crease="faint" />
        </g>

        <g className="ho-rocker">
          {[0, 1, 2, 3, 4].map((part) => (
            <LiveSolid
              key={part}
              tone={part === 4 ? "hi" : "mid"}
              refer={(node) => {
                lever.current[part] = node;
              }}
            />
          ))}
          <circle className="ho-pin" r={0.6} ref={pin} />
        </g>

        <g ref={motorHigh}>
          <Solid paths={MOTOR_ART.stub} tone="mid" crease="none" />
          <Solid paths={MOTOR_ART.nut} tone="mid" crease="faint" />
        </g>
        <g ref={crankHigh}>
          <Solid paths={CRANK_ART.sleeve} tone="mid" crease="none" />
          {[0, 1, 2, 3, 4].map((part) => (
            <LiveSolid
              key={part}
              refer={(node) => {
                arm.current[part] = node;
              }}
            />
          ))}
        </g>

        {STATION_BODY}
        <g className="ho-card" ref={card}>
          <Solid paths={STATION_ART.card} tone="hi" crease="faint">
            <Line d={STATION_ART.note} tone="mid" free />
          </Solid>
        </g>
        <Solid paths={STATION_ART.clip} tone="mid" crease="faint" />
        <Solid paths={STATION_ART.pivot} tone="mid" crease="faint" />
        {[0, 1].map((part) => (
          <LiveSolid
            key={part}
            tone={part ? "hi" : "mid"}
            refer={(node) => {
              flagParts.current[part] = node;
            }}
          />
        ))}
      </svg>

      <span className="lp-corner" data-corner="hint">
        <span className="lp-hover">{t("landing.capabilities.art.handoff.hint")}</span>
        <span className="lp-touch">{t("landing.capabilities.art.handoff.hintTouch")}</span>
      </span>
      <span className="lp-corner" data-corner="readout" ref={readout} />
    </div>
  );
}
