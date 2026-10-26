"use client";

import "@/components/iso/iso.css";
import "./anatomy.css";
import * as React from "react";
import { Dots, Line, Solid } from "@/components/iso/draw";
import { useInView, useLoop } from "@/components/iso/live";
import { useI18n } from "@/lib/i18n/provider";
import {
  BENCH_ART,
  BOOTH_X,
  COUNTER,
  DOCK_X,
  HEIGHT,
  LINES,
  RAILWAY,
  SPIKE_ART,
  SPIKE_MAX,
  STAMP_DROP,
  WIDTH,
  carrier,
  ledgerLine,
  lever,
  leverBoss,
  shift,
  spike,
  tick,
  tickBox,
} from "./payments-geometry";
import { CHARGE, CHARGES, PROVIDERS, PROVIDER_NAMES, STEPS, settle, stepAt, type Entry, type Provider } from "./payments-model";
import { Nap } from "./motion";
import { LiveSolid, paint, put, show } from "./live-solid";

/**
 * Fig 05.6, "Charge in the chat": a shop's cash railway.
 *
 * At the counter the agent writes the charge in the ledger and the ticket —
 * the payment link — goes into the carrier on the wire to the business's
 * processor. The lever fires it; it runs to the booth, where it is paid and
 * stamped; it runs back, which is the processor's webhook, and the ledger's
 * line is ticked. Stripe's wire is behind, Mercado Pago's in front. See
 * `payments-model.ts`.
 */

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
/** Out and back over one move: 0 → 1 → 0. */
const bump = (value: number) => (value <= 0 || value >= 1 ? 0 : Math.sin(value * Math.PI));
const LINE_LENGTHS = [9, 12, 7, 10.5, 8, 11];

type State = {
  clock: number;
  /** Slips on the spike, and how many were last drawn. */
  spiked: number;
  spikeDrawn: number;
  /** Charges made since the page opened; the current one is the last. */
  count: number;
  provider: Provider;
  steered: boolean;
  entries: Entry[];
  shown: string;
};

const CARRIERS = RAILWAY.map((rail) => ({ provider: rail.provider, shape: carrier(rail.y) }));
const LEVER_BOSSES = RAILWAY.map((rail) => leverBoss(rail.y));
const TICK_BOXES = Array.from({ length: LINES }, (_, line) => tickBox(line));
const TICKS = Array.from({ length: LINES }, (_, line) => tick(line));

/** A lever at rest is the same every frame: built once. Pulled, it is built for the frame. */
const AT_REST = RAILWAY.map((rail) => lever(rail.y, 0));
const leverAt = (index: number, pull: number) => (pull === 0 ? AT_REST[index]! : lever(RAILWAY[index]!.y, pull));

export function PaymentsFigure() {
  const { t } = useI18n();
  const root = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const carriers = React.useRef<(SVGGElement | null)[]>([]);
  const tickets = React.useRef<(SVGGElement | null)[]>([]);
  const stamps = React.useRef<(SVGPathElement | null)[]>([]);
  const heads = React.useRef<(SVGGElement | null)[]>([]);
  const levers = React.useRef<(SVGGElement | null)[][]>([]);
  const lines = React.useRef<(SVGPathElement | null)[]>([]);
  const boxes = React.useRef<(SVGPathElement | null)[]>([]);
  const ticks = React.useRef<(SVGPathElement | null)[]>([]);
  const leverPins = React.useRef<(SVGCircleElement | null)[]>([]);
  const slips = React.useRef<(SVGGElement | null)[]>([]);
  const needle = React.useRef<(SVGGElement | null)[]>([]);
  const inView = useInView(root);

  const state = React.useRef<State>({
    clock: 0.4,
    spiked: 4,
    spikeDrawn: -1,
    count: 3,
    provider: "stripe",
    steered: false,
    entries: [
      { charge: 0, provider: "stripe", paid: true },
      { charge: 1, provider: "mercadopago", paid: true },
      { charge: 2, provider: "stripe", paid: false },
    ],
    shown: "",
  });

  const words = React.useMemo(
    () => ({
      creating: (provider: Provider, charge: number) =>
        t("landing.capabilities.art.payments.creating", { provider: PROVIDER_NAMES[provider], amount: `$${CHARGES[charge % CHARGES.length]!.amount}` }),
      waiting: t("landing.capabilities.art.payments.waiting"),
      confirming: (provider: Provider) => t("landing.capabilities.art.payments.confirming", { provider: PROVIDER_NAMES[provider] }),
      paid: (charge: number) => t("landing.capabilities.art.payments.settled", { amount: `$${CHARGES[charge % CHARGES.length]!.amount}` }),
    }),
    [t],
  );

  const draw = React.useCallback(() => {
    const s = state.current;
    const { step, progress } = stepAt(s.clock);
    const entry = s.entries[s.entries.length - 1]!;
    const active = PROVIDERS.indexOf(entry.provider);

    // The carriers: the one on this charge's wire runs out and back; the other waits at the counter.
    CARRIERS.forEach((_, index) => {
      const mine = index === active;
      const out = !mine ? 0 : step === "out" ? smooth(progress) : step === "pay" || step === "stamp" ? 1 : step === "back" ? 1 - smooth(progress) : 0;
      put(carriers.current[index], "transform", shift([(BOOTH_X - DOCK_X) * out, 0, 0]));
      const loaded = mine && step !== "rest";
      show(tickets.current[index], loaded);
      put(tickets.current[index], "opacity", step === "write" ? smooth(progress * 1.5).toFixed(3) : null);
      const marked = mine && (step === "back" || step === "settle" || (step === "stamp" && progress > 0.5));
      put(stamps.current[index], "d", marked ? CARRIERS[index]!.shape.stamped : "");
      const press = mine && step === "stamp" ? bump(progress) : 0;
      put(heads.current[index], "transform", shift([0, 0, -STAMP_DROP * press]));
      const pull = mine && step === "out" ? bump(Math.min(1, progress * 3)) : 0;
      const parts = leverAt(index, pull);
      paint(levers.current[index]?.[0], parts.bar);
      paint(levers.current[index]?.[1], parts.grip);
      put(leverPins.current[index], "cx", parts.pin[0].toFixed(1));
      put(leverPins.current[index], "cy", parts.pin[1].toFixed(1));
    });

    // The ledger's page: this page's lines, each ticked once its payment settled.
    const page = Math.floor((s.entries.length - 1) / LINES);
    for (let line = 0; line < LINES; line++) {
      const held = s.entries[page * LINES + line];
      const isCurrent = held === entry;
      const writing = isCurrent && step === "write" ? smooth(progress * 1.4) : 1;
      put(lines.current[line], "d", held && writing > 0 ? ledgerLine(line, LINE_LENGTHS[held.charge % LINE_LENGTHS.length]! * writing) : "");
      put(boxes.current[line], "d", held ? TICK_BOXES[line]! : "");
      const shown = held?.paid && !(isCurrent && step === "settle" && progress < 0.3);
      put(ticks.current[line], "d", shown ? TICKS[line]! : "");
      put(ticks.current[line], "data-tone", isCurrent ? "lit" : "hi");
    }

    // The spike: a slip for every ticket that came back paid, until it is cleared.
    if (s.spiked !== s.spikeDrawn) {
      s.spikeDrawn = s.spiked;
      const shape = spike(s.spiked);
      paint(needle.current[0], shape.below);
      slips.current.forEach((node, index) => paint(node, shape.slips[index] ?? null));
      paint(needle.current[1], shape.above);
    }

    const text =
      step === "write"
        ? words.creating(entry.provider, entry.charge)
        : step === "out" || step === "pay"
          ? words.waiting
          : step === "stamp" || step === "back"
            ? words.confirming(entry.provider)
            : words.paid(entry.charge);
    if (text !== s.shown && readout.current) {
      readout.current.textContent = text;
      s.shown = text;
    }
  }, [words]);

  const nap = React.useRef<Nap | null>(null);
  const tick_ = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      const before = stepAt(s.clock).step;
      if (calm) s.clock = CHARGE - 0.5;
      else s.clock += dt;
      const { step } = stepAt(s.clock);
      // The webhook lands as the carrier docks: the ledger entry settles, once.
      if (step === "settle" && before !== "settle") settle(s.entries[s.entries.length - 1]!);
      if (calm) settle(s.entries[s.entries.length - 1]!);
      // The paid ticket leaves the carrier for the spike; a full spike is cleared first.
      if (step === "rest" && before !== "rest") s.spiked = s.spiked >= SPIKE_MAX ? 1 : s.spiked + 1;
      if (s.clock >= CHARGE) {
        s.clock -= CHARGE;
        if (!s.steered) s.provider = s.provider === "stripe" ? "mercadopago" : "stripe";
        s.entries.push({ charge: s.count++, provider: s.provider, paid: false });
        if (s.entries.length > LINES * 3) s.entries = s.entries.slice(-LINES * 2 - ((s.entries.length - 1) % LINES) - 1);
      }
      draw();
      if (calm) return false;
      // At the booth waiting to be paid, and back at rest, nothing moves: sleep to the step's end.
      const { step: now, progress } = stepAt(s.clock);
      const length = STEPS.find(([name]) => name === now)?.[1] ?? 0;
      if (now === "pay" || now === "rest") {
        nap.current?.for(Math.max(0.02, (1 - progress) * length), (slept) => {
          state.current.clock += slept;
        });
        return false;
      }
      return true;
    },
    [draw],
  );

  const kick = useLoop(tick_, inView);
  React.useEffect(() => {
    const sleeper = new Nap(kick);
    nap.current = sleeper;
    return () => sleeper.cancel();
  }, [kick]);

  React.useLayoutEffect(() => {
    state.current.shown = "";
    state.current.spikeDrawn = -1;
    draw();
  }, [draw]);

  const choose = (provider: Provider) => {
    state.current.provider = provider;
    state.current.steered = true;
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    // Stripe's wire is the far one, up and to the left; Mercado Pago's runs nearer, lower down.
    choose((event.clientY - box.top) / box.height < 0.5 ? "stripe" : "mercadopago");
  };
  const onPointerLeave = () => {
    state.current.steered = false;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    choose(state.current.provider === "stripe" ? "mercadopago" : "stripe");
  };

  return (
    <div className="iso lp-anatomy pa" ref={root} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown}>
      <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
        <path className="iso-halo" d={BENCH_ART.halo} />
        {BENCH_ART.feet.map((parts, index) => (
          <g key={index}>
            {parts.map((paths, part) => (
              <Solid key={part} paths={paths} tone={part ? "mid" : "lo"} crease="faint" />
            ))}
          </g>
        ))}
        <Solid paths={BENCH_ART.slab} tone="mid" crease="faint" />
        <Line d={BENCH_ART.groove} tone="faint" />
        <Line d={BENCH_ART.screwRings} tone="lo" />
        <Dots points={BENCH_ART.screws} size={0.55} tone="mid" />
        <Solid paths={BENCH_ART.label} tone="lo" crease="none" />
        <Line d={BENCH_ART.labelLine} tone="faint" />
        <Line d={BENCH_ART.labelRules} tone="lo" free />
        <Dots points={BENCH_ART.labelScrews} size={0.45} tone="mid" />

        {RAILWAY.map((rail, index) => (
          <g key={rail.provider}>
            {/* The booth, far down the wire, its window toward the counter. */}
            <Solid paths={rail.booth.body} tone="mid" crease="faint" />
            <path className="lp-void" d={rail.booth.window} />
            <Line d={rail.booth.window} tone="lo" />
            <Solid paths={rail.booth.sill} tone="mid" crease="faint" />
            <Dots points={rail.booth.screws} size={0.45} tone="mid" />
            <Solid paths={rail.booth.sign} tone="mid" crease="faint" />
            <Line d={rail.booth.signRules} tone="lo" free />
            <Dots points={rail.booth.signScrews} size={0.35} tone="mid" />
            <Solid paths={rail.booth.roof} tone="mid" crease="faint" />
            <Solid paths={rail.booth.post} tone="mid" crease="none" />
            <Solid paths={rail.booth.head} tone="mid" crease="faint" />
            <Solid paths={rail.booth.stampArm} tone="mid" crease="faint" />

            <Solid paths={rail.counterPost.foot} tone="lo" crease="faint" />
            <Solid paths={rail.wire} tone="mid" crease="none" />
            {rail.stops.map((paths, stop) => (
              <Solid key={stop} paths={paths} tone="mid" crease="faint" />
            ))}

            <g
              ref={(node) => {
                carriers.current[index] = node;
              }}
            >
              {CARRIERS[index]!.shape.wheels.map((paths, wheel) => (
                <Solid key={wheel} paths={paths} tone="mid" crease="faint" />
              ))}
              <Solid paths={CARRIERS[index]!.shape.trolley} tone="mid" crease="faint" />
              <Solid paths={CARRIERS[index]!.shape.hanger} tone="mid" crease="none" />
              <Solid paths={CARRIERS[index]!.shape.canister} tone="hi" crease="none" inner={<Line d={CARRIERS[index]!.shape.bands} tone="lo" />} />
              <Solid paths={CARRIERS[index]!.shape.lid} tone="mid" crease="faint" />
              <g
                ref={(node) => {
                  tickets.current[index] = node;
                }}
              >
                <Solid paths={CARRIERS[index]!.shape.ticket} tone="hi" crease="faint" lit>
                  <Line d={CARRIERS[index]!.shape.ticketRule} tone="lo" free />
                  <path
                    className="iso-line"
                    data-free=""
                    data-tone="hi"
                    ref={(node) => {
                      stamps.current[index] = node;
                    }}
                  />
                </Solid>
              </g>
            </g>

            <g
              ref={(node) => {
                heads.current[index] = node;
              }}
            >
              <Solid paths={rail.booth.plunger} tone="mid" crease="none" />
              <Solid paths={rail.booth.stampHead} tone="hi" crease="faint" />
            </g>
            <Solid paths={rail.booth.stampBoss} tone="mid" crease="faint" />

            {/* The counter's post, nearer than the docked carrier, and the lever on it. */}
            <Solid paths={rail.counterPost.post} tone="mid" crease="none" inner={<Line d={rail.counterPost.seams} tone="faint" />} />
            <Solid paths={rail.counterPost.head} tone="mid" crease="faint" />
            <Solid paths={LEVER_BOSSES[index]!} tone="mid" crease="none" />
            {[0, 1].map((part) => (
              <LiveSolid
                key={part}
                tone={part ? "hi" : "mid"}
                refer={(node) => {
                  (levers.current[index] ??= [])[part] = node;
                }}
              />
            ))}
            <circle
              className="ho-pin"
              r={0.5}
              ref={(node) => {
                leverPins.current[index] = node;
              }}
            />
          </g>
        ))}

        {/* The spike the paid tickets go on. */}
        <Solid paths={SPIKE_ART.base} tone="lo" crease="faint" />
        <Solid paths={SPIKE_ART.collar} tone="mid" crease="none" />
        <LiveSolid
          refer={(node) => {
            needle.current[0] = node;
          }}
        />
        {Array.from({ length: SPIKE_MAX }, (_, index) => (
          <LiveSolid
            key={index}
            tone="hi"
            refer={(node) => {
              slips.current[index] = node;
            }}
          />
        ))}
        <LiveSolid
          refer={(node) => {
            needle.current[1] = node;
          }}
        />

        {/* The counter and its ledger, nearest. */}
        <Solid paths={COUNTER.desk} tone="mid" crease="faint" />
        <Solid paths={COUNTER.drawer} tone="mid" crease="faint" />
        <Solid paths={COUNTER.drawerKnob} tone="mid" crease="faint" />
        <Solid paths={COUNTER.top} tone="mid" crease="faint" />
        <Solid paths={COUNTER.cover} tone="lo" crease="faint" />
        {COUNTER.pages.map((paths, index) => (
          <Solid key={index} paths={paths} tone="hi" crease="faint" />
        ))}
        <Line d={COUNTER.spine} tone="mid" />
        <Line d={COUNTER.rules} tone="faint" />
        {Array.from({ length: LINES }, (_, line) => (
          <g key={line}>
            <path
              className="iso-line"
              data-free=""
              data-tone="lo"
              ref={(node) => {
                lines.current[line] = node;
              }}
            />
            <path
              className="iso-line"
              data-tone="mid"
              ref={(node) => {
                boxes.current[line] = node;
              }}
            />
            <path
              className="iso-line"
              data-free=""
              data-tone="hi"
              ref={(node) => {
                ticks.current[line] = node;
              }}
            />
          </g>
        ))}
      </svg>

      <span className="lp-corner" data-corner="hint">
        <span className="lp-hover">{t("landing.capabilities.art.payments.hint")}</span>
        <span className="lp-touch">{t("landing.capabilities.art.payments.hintTouch")}</span>
      </span>
      <span className="lp-corner" data-corner="readout" ref={readout} />
    </div>
  );
}
