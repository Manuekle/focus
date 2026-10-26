"use client";

import "@/components/iso/iso.css";
import "./anatomy.css";
import * as React from "react";
import { Dots, Line, Solid } from "@/components/iso/draw";
import { depthOf, translateAlong } from "@/components/iso/iso-kit";
import { useInView, useLoop } from "@/components/iso/live";
import { useI18n } from "@/lib/i18n/provider";
import {
  BENCH,
  CONTACTS,
  DRIVE_ART,
  FEED_Y,
  FILED_MAX,
  FILE_X,
  GATE,
  HEIGHT,
  INTAKE,
  MESSAGE,
  P,
  PIN,
  QUEUE_Y,
  SLOTS_R,
  STAMP,
  STATION_ANGLE,
  TABLE,
  TABLE_ART,
  TRAY_R,
  WIDTH,
  card,
  drive,
  filedCard,
  messageArm,
  queued,
  spider,
  tableAngle,
  tray,
  wheel,
} from "./leads-geometry";
import { Carousel, MOVE, PHASE, STATIONS, type Lead } from "./leads-model";
import { LiveSolid, arrange, paint, put, show } from "./live-solid";

/**
 * Fig 05.3, "Meta Ads leads": an indexing table on a Geneva drive.
 *
 * The drive wheel turns once every five minutes — the dial under it is marked
 * in minutes — and each turn its pin steps the table a quarter turn, so the
 * table polls on its own. Leads arrive from the Meta feeder at the back and
 * wait in the channel, each card tabbed with its campaign. At the intake
 * station the gate lifts and every waiting card goes into the tray at once;
 * the next station stamps them as contacts, the next sets each one's flag (its
 * first message, sent), and the last files them in the contacts box. See
 * `leads-model.ts`.
 */

/** The trays' outer rim, in screen units per radian: how far a turn of the table moves it. */
const RIM_PX = (TRAY_R + 4) * P.scale * Math.sqrt(1.6);

/** Seconds a turn (a poll) takes on the page. */
const PERIOD = 4.6;
/** Where the figure starts: enough polls in that every station has work and the contacts box already holds cards. */
const START = 7.74;
const CARD_SLOTS = 5;
const QUEUE_SLOTS = 4;

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
/** Out and back over one move: 0 → 1 → 0. */
const press = (since: number) => (since < 0 || since > MOVE ? 0 : Math.sin((since / MOVE) * Math.PI));

type CardShape = ReturnType<typeof card>;

/** Writes a card into its group: body, tab, form lines, stamp, flag stalk, flag. `null` hides it. */
function writeCard(group: SVGGElement | null | undefined, shape: CardShape | ReturnType<typeof queued> | null, lit = false) {
  if (!group) return;
  show(group, !!shape);
  if (!shape) return;
  const [body, tab, rules, stamp, stalk, flag] = Array.from(group.children);
  paint(body, shape.body);
  paint(tab, shape.tab);
  const full = "rules" in shape ? shape : null;
  put(rules, "d", full?.rules ?? "");
  put(stamp, "d", full?.stamp ?? "");
  paint(stalk, full?.stalk ?? null);
  paint(flag, full?.flag ?? null);
  put(flag, "data-lit", lit ? "" : null);
}

function CardSlot({ refer, tone = "hi" }: { refer: (node: SVGGElement | null) => void; tone?: "hi" | "mid" }) {
  return (
    <g className="ld-card" ref={refer} display="none">
      <LiveSolid tone={tone} refer={() => {}} />
      <LiveSolid refer={() => {}} />
      <path className="iso-line" data-free="" data-tone="faint" />
      <path className="iso-line" data-free="" data-tone="mid" />
      <LiveSolid refer={() => {}} />
      <LiveSolid tone="hi" refer={() => {}} />
    </g>
  );
}

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
  </g>
);

const FEEDER_ART = (
  <g key="feeder">
    <Solid paths={INTAKE.stand} tone="lo" crease="faint" />
    <Solid paths={INTAKE.feeder} tone="mid" crease="faint" />
    <path className="lp-void" d={INTAKE.slot} />
    <Line d={INTAKE.slot} tone="lo" />
    <Dots points={INTAKE.feederScrews} size={0.45} tone="mid" />
    <Solid paths={INTAKE.mastFoot} tone="mid" crease="faint" />
    <Solid paths={INTAKE.mast} tone="mid" crease="none" />
    <Solid paths={INTAKE.mastTip} tone="hi" crease="none" />
    {INTAKE.posts.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="none" />
    ))}
    <Solid paths={INTAKE.wallFar} tone="mid" crease="faint" />
    <Solid paths={INTAKE.floor} tone="mid" crease="faint" />
  </g>
);

const BOX_BACK = (
  <g key="box-back">
    {CONTACTS.legs.map((paths, index) => (
      <Solid key={index} paths={paths} tone="mid" crease="none" />
    ))}
    <Solid paths={CONTACTS.floor} tone="mid" crease="faint" />
    <Solid paths={CONTACTS.back} tone="mid" crease="faint" />
    <Solid paths={CONTACTS.far} tone="mid" crease="faint" />
  </g>
);

const DRIVE_BASE = (
  <g key="drive">
    <Solid paths={TABLE_ART.pillar} tone="lo" crease="faint" />
    <Dots points={TABLE_ART.pillarScrews} size={0.45} tone="mid" />
    <Solid paths={TABLE_ART.bearing} tone="mid" crease="none" />
    <Solid paths={DRIVE_ART.gearbox} tone="lo" crease="faint" />
    <Dots points={DRIVE_ART.gearboxScrews} size={0.45} tone="mid" />
    <Solid paths={DRIVE_ART.motor} tone="mid" crease="none" inner={<Line d={DRIVE_ART.motorSeams} tone="lo" />} />
    <Solid paths={DRIVE_ART.motorCap} tone="mid" crease="faint" />
    <Solid paths={DRIVE_ART.dial} tone="mid" crease="faint" />
    <Line d={DRIVE_ART.dialMinor} tone="lo" />
    <Line d={DRIVE_ART.dialMajor} tone="hi" />
    <Solid paths={DRIVE_ART.hub} tone="mid" crease="none" />
  </g>
);

// ── the live figure ─────────────────────────────────────────────────────

type State = {
  time: number;
  boost: number;
  pointer: number | null;
  carousel: Carousel;
  shown: string;
  /** What each moving group was last drawn for, so a frame redraws only what changed. */
  angle: number;
  trays: string[];
  queue: string;
  box: string;
  down: number;
};

export function LeadsFigure() {
  const { t } = useI18n();
  const root = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const wheelRef = React.useRef<SVGGElement | null>(null);
  const driveParts = React.useRef<(SVGGElement | null)[]>([]);
  const pinRef = React.useRef<SVGGElement>(null);
  const armsBack = React.useRef<(SVGGElement | null)[]>([]);
  const armsFront = React.useRef<(SVGGElement | null)[]>([]);
  const trayGroups = React.useRef<(SVGGElement | null)[]>([]);
  /** Each tray's parts by name: their places in the group change as they are sorted, so never find them by position. */
  const trayParts = React.useRef<{ walls: (SVGGElement | null)[]; slots: (SVGGElement | null)[] }[]>(
    Array.from({ length: STATIONS }, () => ({ walls: [], slots: [] })),
  );
  const trayLayer = React.useRef<SVGGElement>(null);
  const queueCards = React.useRef<(SVGGElement | null)[]>([]);
  const queueLayer = React.useRef<SVGGElement>(null);
  const boxCards = React.useRef<(SVGGElement | null)[]>([]);
  const gate = React.useRef<SVGGElement>(null);
  const ram = React.useRef<SVGGElement>(null);
  const head = React.useRef<SVGGElement>(null);
  const messageArmRef = React.useRef<SVGGElement | null>(null);
  const inView = useInView(root);

  const [initial] = React.useState<State>(() => {
    const carousel = new Carousel();
    carousel.advance(START);
    return { time: START, boost: 0, pointer: null, carousel, shown: "", angle: Number.NaN, trays: [], queue: "", box: "", down: Number.NaN };
  });
  const state = React.useRef<State>(initial);

  const status = React.useCallback((taken: number, sent: number) => t("landing.capabilities.art.leads.status", { leads: taken, sent }), [t]);

  const draw = React.useCallback(() => {
    const s = state.current;
    const time = s.time;
    const carousel = s.carousel;
    // The table's angle as drawn: a turn smaller than a third of a pixel at the
    // trays' rim waits for the next, so the Geneva's slow start and finish
    // don't rebuild the whole table for nothing.
    const turning = tableAngle(time);
    const angle = Number.isNaN(s.angle) || Math.abs(turning - s.angle) * RIM_PX > 0.3 || turning % (Math.PI / 2) === 0 ? turning : s.angle;
    const steps = Carousel.steps(time);
    const turn = Math.floor(time);
    const local = time - turn;

    // The drive turns all the time; the wheel and the table only while the pin is in a slot.
    const parts = drive(time);
    paint(driveParts.current[0], parts.lock);
    paint(driveParts.current[1], parts.arm);
    put(pinRef.current, "transform", parts.pin);
    paint(driveParts.current[3], parts.cap);
    if (angle !== s.angle) {
      paint(wheelRef.current, wheel(angle));
      const legs = spider(angle);
      const centre = depthOf([TABLE[0], TABLE[1], 0], P);
      legs.arms.forEach((arm, index) => {
        const front = depthOf(arm.depth, P) > centre;
        paint(armsBack.current[index], front ? null : arm.paths);
        paint(armsFront.current[index], front ? arm.paths : null);
      });
    }

    // Each tray, its walls and its cards, in depth order; the trays themselves
    // too. A tray is rewritten only when it has turned or a card in it has
    // moved, which is a few frames a poll: the rest of the time it stands.
    const trayOrder: { node: SVGGElement; depth: number }[] = [];
    for (let index = 0; index < STATIONS; index++) {
      const group = trayGroups.current[index];
      if (!group) continue;
      const a = angle + STATION_ANGLE[0]! + index * (Math.PI / 2);
      const station = Carousel.stationOf(index, steps);
      const depthAt = (r: number, along: number): number =>
        depthOf([TABLE[0] + Math.cos(a) * r - Math.sin(a) * along, TABLE[1] + Math.sin(a) * r + Math.cos(a) * along, 0], P);
      trayOrder.push({ node: group, depth: depthAt(TRAY_R, 0) });

      const held = carousel.trays[index]!;
      const stamped = held.stampedAt !== null && time >= held.stampedAt + MOVE / 2 ? 1 : 0;
      const flag = held.sentAt !== null ? smooth((time - held.sentAt - MOVE / 2) / (MOVE / 2)) : 0;
      const cards: { r: number; lead: Lead; stamped: number; flag: number; lit: boolean }[] = held.cards.map((lead, place) => {
        const into = lead.takenAt !== undefined ? smooth((time - lead.takenAt) / MOVE) : 1;
        const from = TABLE[1] - QUEUE_Y[Math.min(lead.slot ?? 0, QUEUE_Y.length - 1)]!;
        return { r: from + (SLOTS_R[place]! - from) * into, lead, stamped, flag, lit: station === 2 && flag > 0 };
      });
      // Cards on their way out of the filing station's tray, into the box.
      if (station === 3) {
        for (const lead of carousel.filed) {
          if (lead.filedAt === undefined || time >= lead.filedAt + MOVE) continue;
          const out = smooth((time - lead.filedAt) / MOVE);
          const from = SLOTS_R[lead.from ?? 0]!;
          cards.push({ r: from + (TABLE[0] - FILE_X(0) - from) * out, lead, stamped: 1, flag: 1 - out, lit: false });
        }
      }
      const key = `${a.toFixed(5)}|${cards.map((held) => `${held.r.toFixed(3)} ${held.lead.campaign} ${held.stamped} ${held.flag.toFixed(3)} ${held.lit}`).join(";")}`;
      if (s.trays[index] === key) continue;
      s.trays[index] = key;

      const parts = trayParts.current[index]!;
      const [floor, inner, endA, endB] = parts.walls;
      const slots = parts.slots.filter((slot): slot is SVGGElement => !!slot);
      if (!floor || !inner || !endA || !endB) continue;
      const shape = tray(a);
      paint(floor, shape.floor);
      paint(inner, shape.inner);
      paint(endA, shape.ends[0]!.paths);
      paint(endB, shape.ends[1]!.paths);
      const order: { node: Element; depth: number }[] = [
        { node: inner, depth: depthAt(TRAY_R - 2.8, 0) },
        { node: endA, depth: depthAt(TRAY_R, -5.1) },
        { node: endB, depth: depthAt(TRAY_R, 5.1) },
      ];
      slots.forEach((slot, place) => {
        const card_ = cards[place];
        if (!card_) return writeCard(slot, null);
        writeCard(slot, card(a, card_.r, card_.lead.campaign, card_.stamped, card_.flag), card_.lit);
        order.push({ node: slot, depth: depthAt(card_.r, 0) });
      });
      // The hidden slots keep their place at the end.
      const placed = order.sort((x, y) => x.depth - y.depth).map(({ node }) => node);
      arrange(group, [...placed, ...slots.filter((slot) => !placed.includes(slot))]);
    }
    arrange(
      trayLayer.current,
      trayOrder.sort((x, y) => x.depth - y.depth).map(({ node }) => node),
    );
    s.angle = angle;

    // The channel: cards coming out of the feeder, waiting at the gate.
    const waiting = carousel.queue.map((lead, place) => {
      const at = QUEUE_Y[Math.min(place, QUEUE_Y.length - 1)]!;
      return { lead, y: FEED_Y + (at - FEED_Y) * smooth((time - lead.arrives) / MOVE) };
    });
    const queueKey = waiting.map((held) => `${held.y.toFixed(3)} ${held.lead.campaign}`).join(";");
    if (queueKey !== s.queue) {
      s.queue = queueKey;
      queueCards.current.forEach((slot, place) => {
        const waitingCard = waiting[place];
        writeCard(slot, waitingCard ? queued(waitingCard.y, waitingCard.lead.campaign) : null);
      });
      arrange(
        queueLayer.current,
        queueCards.current
          .map((node, place) => ({ node, y: waiting[place]?.y ?? -1 }))
          .sort((x, y) => x.y - y.y)
          .flatMap(({ node }) => (node ? [node] : [])),
      );
    }

    // The gate lifts for the poll.
    const open = smooth((local - PHASE.intake + 0.05) / 0.04) * (1 - smooth((local - PHASE.intake - MOVE - 0.01) / 0.05));
    put(gate.current, "transform", translateAlong(P, [0, 0, GATE.lift * open]));

    // The stamp presses the cards at its station, and the head sets the flags at its own.
    const stampTray = carousel.trays.findIndex((_, index) => Carousel.stationOf(index, steps) === 1);
    const stampedAt = carousel.trays[stampTray]?.stampedAt;
    const stroke = stampedAt != null ? press(time - stampedAt) : 0;
    put(ram.current, "transform", translateAlong(P, [-STAMP.stroke * stroke, 0, 0]));
    const messageTray = carousel.trays.findIndex((_, index) => Carousel.stationOf(index, steps) === 2);
    const sentAt = carousel.trays[messageTray]?.sentAt;
    const down = (sentAt != null ? press(time - sentAt) : 0) * MESSAGE.dip;
    if (down !== s.down) {
      s.down = down;
      put(head.current, "transform", translateAlong(P, [0, 0, -down]));
      paint(messageArmRef.current, messageArm(down));
    }

    // The contacts box: every card filed, the newest by the opening, sliding older ones in as it lands.
    const filed = carousel.filed.filter((lead) => lead.filedAt !== undefined && time >= lead.filedAt + MOVE);
    const kept = filed.slice(-FILED_MAX);
    const places = kept.map((_, index) => kept.slice(index + 1).reduce((sum, newer) => sum + smooth((time - newer.filedAt! - MOVE) / (MOVE * 0.6)), 0));
    const boxKey = kept.map((lead, index) => `${lead.id} ${places[index]!.toFixed(3)}`).join(";");
    if (boxKey !== s.box) {
      s.box = boxKey;
      boxCards.current.forEach((slot, index) => {
        const lead = kept[index];
        writeCard(slot, lead ? filedCard(FILE_X(places[index]!), lead.campaign) : null);
      });
    }

    const text = status(carousel.taken, carousel.sent);
    if (text !== s.shown && readout.current) {
      readout.current.textContent = text;
      s.shown = text;
    }
  }, [status]);

  const tick = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      if (calm) {
        s.time += s.boost;
        s.boost = 0;
      } else {
        const drain = s.boost * (1 - Math.exp(-dt / 0.35));
        s.boost -= drain;
        s.time += dt / PERIOD + drain;
      }
      s.carousel.advance(s.time);
      draw();
      return !calm;
    },
    [draw],
  );

  const kick = useLoop(tick, inView);

  React.useLayoutEffect(() => {
    Object.assign(state.current, { shown: "", angle: Number.NaN, trays: [], queue: "", box: "", down: Number.NaN });
    draw();
  }, [draw]);

  // Moving across winds the clock forward, as far as the pointer travels; a tap winds one poll.
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const s = state.current;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    if (s.pointer !== null) s.boost += Math.abs(x - s.pointer) * 1.6;
    s.pointer = x;
    kick();
  };
  const onPointerLeave = () => {
    state.current.pointer = null;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    state.current.boost += 1;
    kick();
  };

  return (
    <div className="iso lp-anatomy ld" ref={root} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown}>
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        {BENCH_ART}
        {FEEDER_ART}
        <g ref={queueLayer}>
          {Array.from({ length: QUEUE_SLOTS }, (_, index) => (
            <CardSlot
              key={index}
              refer={(node) => {
                queueCards.current[index] = node;
              }}
            />
          ))}
        </g>
        <Solid paths={INTAKE.wallNear} tone="mid" crease="faint" inner={<Line d={INTAKE.wallSeam} tone="faint" />} />
        <Solid paths={GATE.guides[0]!} tone="mid" crease="none" />
        <g ref={gate}>
          <Solid paths={GATE.plate} tone="mid" crease="faint" />
        </g>
        <Solid paths={GATE.guides[1]!} tone="mid" crease="none" />
        <Solid paths={GATE.bar} tone="mid" crease="faint" />

        {BOX_BACK}
        {Array.from({ length: FILED_MAX }, (_, index) => (
          <CardSlot
            key={index}
            tone="mid"
            refer={(node) => {
              boxCards.current[index] = node;
            }}
          />
        ))}
        <Solid paths={CONTACTS.front} tone="mid" crease="faint" inner={<Line d={CONTACTS.frontSeam} tone="faint" />} />

        {DRIVE_BASE}
        <LiveSolid
          refer={(node) => {
            wheelRef.current = node;
          }}
        />
        <Solid paths={TABLE_ART.shaft} tone="mid" crease="none" />
        {[0, 1].map((part) => (
          <LiveSolid
            key={part}
            refer={(node) => {
              driveParts.current[part] = node;
            }}
          />
        ))}
        <g ref={pinRef}>
          <Solid paths={PIN} tone="hi" crease="none" />
        </g>
        <LiveSolid
          refer={(node) => {
            driveParts.current[3] = node;
          }}
        />

        {[0, 1, 2, 3].map((arm) => (
          <LiveSolid
            key={`b${arm}`}
            refer={(node) => {
              armsBack.current[arm] = node;
            }}
          />
        ))}
        <SpiderHub />
        {[0, 1, 2, 3].map((arm) => (
          <LiveSolid
            key={`f${arm}`}
            refer={(node) => {
              armsFront.current[arm] = node;
            }}
          />
        ))}

        <g ref={trayLayer}>
          {Array.from({ length: STATIONS }, (_, index) => (
            <g
              key={index}
              ref={(node) => {
                trayGroups.current[index] = node;
              }}
            >
              {[0, 1, 2, 3].map((part) => (
                <LiveSolid
                  key={part}
                  refer={(node) => {
                    trayParts.current[index]!.walls[part] = node;
                  }}
                />
              ))}
              {Array.from({ length: CARD_SLOTS }, (_, slot) => (
                <CardSlot
                  key={slot}
                  refer={(node) => {
                    trayParts.current[index]!.slots[slot] = node;
                  }}
                />
              ))}
            </g>
          ))}
        </g>

        <Solid paths={STAMP.foot} tone="lo" crease="faint" />
        <Solid paths={STAMP.post} tone="mid" crease="none" />
        <g ref={ram}>
          <Solid paths={STAMP.ram} tone="mid" crease="none" />
          <Solid paths={STAMP.pad} tone="hi" crease="faint" />
        </g>
        <Solid paths={STAMP.housing} tone="mid" crease="faint" />
        <Dots points={STAMP.housingScrews} size={0.45} tone="mid" />

        <Solid paths={MESSAGE.foot} tone="lo" crease="faint" />
        <Dots points={MESSAGE.footScrews} size={0.45} tone="mid" />
        <Solid paths={MESSAGE.post} tone="mid" crease="none" inner={<Line d={MESSAGE.seams} tone="faint" />} />
        <g ref={head}>
          <Solid paths={MESSAGE.head} tone="mid" crease="faint" />
          <Dots points={MESSAGE.headScrews} size={0.45} tone="mid" />
        </g>
        <LiveSolid
          refer={(node) => {
            messageArmRef.current = node;
          }}
        />
        <Solid paths={MESSAGE.knuckle} tone="mid" crease="faint" />
      </svg>

      <span className="lp-corner" data-corner="hint">
        <span className="lp-hover">{t("landing.capabilities.art.leads.hint")}</span>
        <span className="lp-touch">{t("landing.capabilities.art.leads.hintTouch")}</span>
      </span>
      <span className="lp-corner" data-corner="readout" ref={readout} />
    </div>
  );
}

const HUB = spider(0);
function SpiderHub() {
  return (
    <g>
      <Solid paths={HUB.hub} tone="mid" crease="faint" />
      <Line d={HUB.hubRing} tone="lo" />
    </g>
  );
}

