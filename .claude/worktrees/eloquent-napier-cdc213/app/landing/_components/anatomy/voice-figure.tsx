"use client";

import "@/components/iso/iso.css";
import "./anatomy.css";
import * as React from "react";
import { Dots, Line, Solid } from "@/components/iso/draw";
import { useInView, useLoop } from "@/components/iso/live";
import { useI18n } from "@/lib/i18n/provider";
import {
  AMPLITUDE,
  BAND_Z,
  BELL_ART,
  BENCH_ART,
  HEIGHT,
  JACK_ART,
  KYMO,
  LIFTER_ART,
  LINE_GAP,
  PEN_ANGLE,
  PHONE_ART,
  PICK,
  SELECTOR_ART,
  SHEETS_MAX,
  STAND_ART,
  TRAY_ART,
  VOICE_ANGLE,
  WIDTH,
  drumMarks,
  drumSamples,
  pointer,
  sheet,
  sheetLines,
  shift,
} from "./voice-geometry";
import { Cable } from "./cable";
import { put, show } from "./live-solid";
import { BANDS, CALL, HANGUP, PAUSE, PICKUP, RING, TALK, TURNS, VOICES, speakerAt, waveAt } from "./voice-model";

/**
 * Fig 05.5, "Voice agents": a desk telephone wired to a kymograph.
 *
 * A call comes in and the bell rings; the handset lifts by itself — the agent
 * answers. The drum turns once for the call while two pens write it, the
 * caller's line above and the agent's below in the shape of the voice set on
 * the selector, and when the agent hangs up the band stays on the sheet. Three
 * calls fill a sheet, and a full sheet is filed on the tray. See
 * `voice-model.ts`.
 */

const TAU = Math.PI * 2;
const POINTERS = VOICE_ANGLE.map((angle) => pointer(angle));
const SHEET_TEXT = Array.from({ length: SHEETS_MAX + 1 }, (_, count) => sheetLines(count));
/** How finely the drum's visible half is sampled for the pens' lines, in radians. */
const STEP = (2.4 * Math.PI) / 180;

/** The drum's visible half, sampled once. */
const SAMPLES = drumSamples(STEP);
/** Samples round a sheet, for its lines' heights. */
const SHEET = 1440;

/**
 * A line's height off its rest all the way round its sheet, for the voices a
 * band was written in: worked out once per band and voice change, then only
 * looked up as the drum turns.
 */
const HEIGHTS = new WeakMap<object, Map<"caller" | "agent", { key: string; heights: Float32Array }>>();
function heightsOf(band: { voices: { from: number; voice: number }[] }, who: "caller" | "agent") {
  let held = HEIGHTS.get(band);
  if (!held) HEIGHTS.set(band, (held = new Map()));
  const key = band.voices.map((voice) => `${voice.from}:${voice.voice}`).join(",");
  const kept = held.get(who);
  if (kept?.key === key) return kept.heights;
  // The voice in force at a share of the call: the last change at or before it.
  const voices = [...band.voices].sort((x, y) => y.from - x.from);
  const heights = new Float32Array(SHEET);
  for (let index = 0; index < SHEET; index++) {
    const share = index / SHEET;
    if (speakerAt(share) !== who) continue;
    const voice = voices.find((change) => change.from <= share)?.voice ?? 0;
    heights[index] = AMPLITUDE * envelope(share) * waveAt(who === "caller" ? "caller" : VOICES[voice]!.wave, share * TAU);
  }
  held.set(who, { key, heights });
  return heights;
}

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
const frac = (value: number) => ((value % 1) + 1) % 1;

type Phase = "ring" | "pickup" | "talk" | "hangup" | "pause";
function phaseAt(clock: number): { phase: Phase; progress: number } {
  let t = clock;
  for (const [phase, length] of [
    ["ring", RING],
    ["pickup", PICKUP],
    ["talk", TALK],
    ["hangup", HANGUP],
    ["pause", PAUSE],
  ] as const) {
    if (t < length) return { phase, progress: t / length };
    t -= length;
  }
  return { phase: "pause", progress: 1 };
}

/** How loud a line is at `share` of the call: rising into each turn and falling out of it, so no line jumps. */
function envelope(share: number) {
  let at = 0;
  for (const turn of TURNS) {
    if (share < at + turn.share) {
      const inside = (share - at) / turn.share;
      return Math.sin(Math.PI * Math.min(1, Math.max(0, inside)));
    }
    at += turn.share;
  }
  return 0;
}

/** A band on the sheet: the voice in force from each share of its call on. */
type Band = { voices: { from: number; voice: number }[] };

type State = {
  clock: number;
  /** Calls answered since the page opened. */
  calls: number;
  voice: number;
  steered: boolean;
  bands: Band[];
  filed: number;
  shown: string;
  /** What the drum's lines were last drawn for. */
  drawn: string;
};

export function VoiceFigure() {
  const { t } = useI18n();
  const root = React.useRef<HTMLDivElement>(null);
  const readout = React.useRef<HTMLSpanElement>(null);
  const handset = React.useRef<SVGGElement>(null);
  const hammer = React.useRef<SVGGElement>(null);
  const carriage = React.useRef<SVGGElement>(null);
  const marks = React.useRef<SVGPathElement>(null);
  const lines = React.useRef<(SVGPathElement | null)[]>([]);
  const knobPointer = React.useRef<SVGPathElement>(null);
  const sheets = React.useRef<(SVGGElement | null)[]>([]);
  const sheetText = React.useRef<SVGPathElement>(null);
  const inView = useInView(root);

  const state = React.useRef<State>({
    clock: RING + PICKUP + TALK * 0.55,
    calls: 1,
    voice: 0,
    steered: false,
    bands: [{ voices: [{ from: 0, voice: 2 }] }, { voices: [{ from: 0, voice: 0 }] }],
    filed: 2,
    shown: "",
    drawn: "",
  });

  const words = React.useMemo(
    () => ({
      ringing: t("landing.capabilities.art.voice.ringing"),
      talking: (voice: number) => t("landing.capabilities.art.voice.talking", { voice: VOICES[voice]!.name }),
      kept: (calls: number) => t("landing.capabilities.art.voice.kept", { calls }),
    }),
    [t],
  );

  const draw = React.useCallback(() => {
    const s = state.current;
    const { phase, progress } = phaseAt(s.clock);
    const band = s.bands.length - 1;
    const talking = phase === "talk" ? progress : phase === "ring" || phase === "pickup" ? 0 : 1;
    // The drum has turned once for every call before this one, and as far as this one has gone.
    const turned = TAU * (s.calls - 1 + talking);
    const filing = phase === "pause" && s.bands.length === BANDS ? smooth(progress * 1.4) : 0;

    // Each band's two lines, as far round the drum's visible half as they are
    // written: rebuilt only while the drum turns or the voice changes, from
    // each band's heights worked out once along its sheet.
    const record = `${turned.toFixed(5)} ${talking.toFixed(5)} ${s.bands.map((entry) => entry.voices.map((voice) => `${voice.from}:${voice.voice}`).join(",")).join("|")}`;
    if (record !== s.drawn) {
      s.drawn = record;
      for (let index = 0; index < BANDS; index++) {
        const entry = s.bands[index];
        for (const [line, who] of (["caller", "agent"] as const).entries()) {
          const node = lines.current[index * 2 + line];
          if (!entry) {
            put(node, "d", "");
            continue;
          }
          const heights = heightsOf(entry, who);
          const rest = BAND_Z[index]! + (who === "caller" ? LINE_GAP : -LINE_GAP);
          let d = "";
          let open = false;
          let count = 0;
          for (let sample = 0; sample < SAMPLES.angles.length; sample++) {
            // Where on the sheet this is, and how far into its call that was written.
            const share = frac((PEN_ANGLE - (SAMPLES.angles[sample]! - turned)) / TAU);
            const written = index < band || share <= talking + 1e-6;
            if (!written) {
              open = false;
              continue;
            }
            const z = rest + heights[Math.round(share * SHEET) % SHEET]!;
            const [bx, by] = SAMPLES.base[sample]!;
            d += `${open ? "L" : "M"}${(bx + SAMPLES.up[0] * z).toFixed(1)} ${(by + SAMPLES.up[1] * z).toFixed(1)}`;
            open = true;
            count++;
          }
          put(node, "d", count > 1 ? d : "");
        }
      }
      put(marks.current, "d", drumMarks(turned));
    }
    lines.current.forEach((node) => put(node, "stroke-opacity", filing > 0 ? (1 - filing).toFixed(2) : null));

    // The telephone: the bell's hammer shakes while it rings; the handset lifts for the call.
    const shake = phase === "ring" ? Math.sin(progress * RING * 2 * Math.PI * 14) * 0.35 * Math.sin(progress * Math.PI) : 0;
    put(hammer.current, "transform", shift([0, shake, 0]));
    const lift = phase === "pickup" ? smooth(progress) : phase === "talk" ? 1 : phase === "hangup" ? 1 - smooth(progress) : 0;
    put(handset.current, "transform", shift([0, 0, PICK * lift]));

    // The pen carriage stands at this call's band, and climbs to the next between calls.
    const next = s.bands.length >= BANDS ? 0 : s.bands.length;
    const climb = phase === "pause" ? smooth((progress - 0.3) / 0.6) : 0;
    const level = BAND_Z[band]! + (BAND_Z[next]! - BAND_Z[band]!) * climb - BAND_Z[0]!;
    put(carriage.current, "transform", shift([0, 0, level]));

    put(knobPointer.current, "d", POINTERS[s.voice]!);
    // The tray holds the sheets filed so far; a full one lands on it as its lines fade from the drum.
    const stacked = Math.min(SHEETS_MAX, s.filed + (filing > 0.6 ? 1 : 0));
    sheets.current.forEach((node, index) => show(node, index < stacked));
    put(sheetText.current, "d", SHEET_TEXT[stacked] ?? "");

    const text = phase === "ring" ? words.ringing : phase === "pickup" || phase === "talk" ? words.talking(s.voice) : words.kept(s.calls);
    if (text !== s.shown && readout.current) {
      readout.current.textContent = text;
      s.shown = text;
    }
  }, [words]);

  const tick = React.useCallback(
    (dt: number, calm: boolean) => {
      const s = state.current;
      if (calm) s.clock = RING + PICKUP + TALK * 0.7;
      else s.clock += dt;
      if (s.clock >= CALL) {
        // The next call: a new band, or a fresh sheet once this one is full and filed.
        s.clock -= CALL;
        s.calls++;
        if (s.bands.length >= BANDS) {
          s.bands = [];
          s.filed++;
        }
        if (!s.steered) s.voice = (s.voice + 1) % VOICES.length;
        s.bands.push({ voices: [{ from: 0, voice: s.voice }] });
      }
      draw();
      return !calm;
    },
    [draw],
  );

  const kick = useLoop(tick, inView);

  React.useLayoutEffect(() => {
    state.current.shown = "";
    state.current.drawn = "";
    draw();
  }, [draw]);

  /** A new voice takes over the agent's line from where the pen is now. */
  const choose = (voice: number) => {
    const s = state.current;
    if (voice === s.voice) return;
    s.voice = voice;
    const { phase, progress } = phaseAt(s.clock);
    const share = phase === "talk" ? progress : phase === "ring" || phase === "pickup" ? 0 : 1;
    s.bands[s.bands.length - 1]?.voices.push({ from: share, voice });
    kick();
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    state.current.steered = true;
    choose(Math.min(VOICES.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * VOICES.length))));
  };
  const onPointerLeave = () => {
    state.current.steered = false;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    state.current.steered = true;
    choose((state.current.voice + 1) % VOICES.length);
  };

  return (
    <div className="iso lp-anatomy vo" ref={root} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown}>
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

        {/* The wall jack the line comes in by, and the cords along the bench. */}
        <Solid paths={JACK_ART.box} tone="mid" crease="faint" />
        <Solid paths={JACK_ART.plate} tone="mid" crease="none" />
        <Dots points={JACK_ART.screws} size={0.4} tone="mid" />
        <Solid paths={BENCH_ART.sleeves[3]!} tone="mid" crease="none" />
        <Cable points={BENCH_ART.lineCord} radius={2.4} />

        {/* The filed sheets, behind the drum. */}
        <Solid paths={TRAY_ART.tray} tone="lo" crease="faint" />
        <Solid paths={TRAY_ART.lip} tone="mid" crease="faint" />
        {Array.from({ length: SHEETS_MAX }, (_, index) => (
          <g
            key={index}
            ref={(node) => {
              sheets.current[index] = node;
            }}
          >
            <Solid paths={sheet(index)} tone="hi" crease="faint" />
          </g>
        ))}
        <path className="iso-line" data-free="" data-tone="faint" ref={sheetText} />

        {/* The kymograph. */}
        <Solid paths={KYMO.clock} tone="lo" crease="faint" />
        <Dots points={KYMO.clockScrews} size={0.45} tone="mid" />
        <Solid paths={KYMO.keyBoss} tone="mid" crease="faint" />
        <Solid paths={KYMO.key} tone="mid" crease="faint" />
        <Solid paths={KYMO.collar} tone="mid" crease="faint" />
        <Solid paths={KYMO.rimBottom} tone="mid" crease="none" />
        <Solid paths={KYMO.drum} tone="hi" crease="none" />
        {Array.from({ length: BANDS * 2 }, (_, index) => (
          <path
            className="iso-line"
            data-free=""
            data-tone={index % 2 ? "hi" : "lo"}
            key={index}
            ref={(node) => {
              lines.current[index] = node;
            }}
          />
        ))}
        <Solid paths={KYMO.rim} tone="mid" crease="faint" />
        <path className="iso-line" data-tone="lo" ref={marks} />
        <Solid paths={KYMO.spindle} tone="mid" crease="none" />
        <Solid paths={KYMO.spindleCap} tone="mid" crease="faint" />

        {/* The pen stand, in front of the drum. */}
        <Solid paths={STAND_ART.foot} tone="lo" crease="faint" />
        <Dots points={STAND_ART.footScrews} size={0.45} tone="mid" />
        <Solid paths={STAND_ART.post} tone="mid" crease="none" />
        <Solid paths={STAND_ART.postCap} tone="mid" crease="faint" />
        <g ref={carriage}>
          {STAND_ART.arms.map((arm) => (
            <g key={arm.side}>
              <Solid paths={arm.arm} tone="mid" crease="faint" />
              <Solid paths={arm.pen} tone={arm.side < 0 ? "hi" : "mid"} crease="none" />
              <Dots points={[arm.tip]} size={0.5} tone="hi" />
            </g>
          ))}
          <Solid paths={STAND_ART.carriage} tone="mid" crease="faint" />
          <Line d={STAND_ART.screw} tone="lo" />
        </g>

        {/* The telephone. */}
        <Solid paths={PHONE_ART.base} tone="mid" crease="faint" />
        <Solid paths={BENCH_ART.sleeves[0]!} tone="mid" crease="none" />
        <Solid paths={BENCH_ART.sleeves[1]!} tone="mid" crease="none" />
        <Solid paths={PHONE_ART.top} tone="mid" crease="faint" />
        <Solid paths={PHONE_ART.dial} tone="mid" crease="faint" />
        <Line d={PHONE_ART.dialHoles} tone="lo" />
        <Solid paths={PHONE_ART.stop} tone="mid" crease="none" />
        <Solid paths={PHONE_ART.centre} tone="hi" crease="faint" />
        {PHONE_ART.hooks.map((hook, index) => (
          <g key={index}>
            <Solid paths={hook.post} tone="mid" crease="none" />
            <Solid paths={hook.fork} tone="mid" crease="faint" />
          </g>
        ))}
        <Solid paths={LIFTER_ART.foot} tone="lo" crease="faint" />
        <Dots points={LIFTER_ART.footScrews} size={0.4} tone="mid" />
        <Solid paths={LIFTER_ART.post} tone="mid" crease="none" />
        <Solid paths={LIFTER_ART.cap} tone="mid" crease="faint" />
        <Cable points={BENCH_ART.phoneCord} radius={2.4} />
        <Cable points={BENCH_ART.selectorCord} radius={2.4} />
        <Solid paths={BENCH_ART.clockSocket} tone="mid" crease="faint" />
        <g ref={handset}>
          <Solid paths={LIFTER_ART.arm} tone="mid" crease="faint" />
          <Solid paths={LIFTER_ART.collar} tone="mid" crease="faint" />
          {PHONE_ART.cups.map((paths, index) => (
            <Solid key={index} paths={paths} tone="mid" crease="faint" />
          ))}
          <Solid paths={PHONE_ART.grip} tone="hi" crease="faint" />
          {PHONE_ART.cupHoles.map((d, index) => (
            <Line key={index} d={d} tone="lo" />
          ))}
        </g>

        {/* The bell, on its post in front of the telephone. */}
        <Solid paths={BELL_ART.post} tone="mid" crease="none" />
        <Solid paths={BELL_ART.hammerPost} tone="mid" crease="none" />
        <Solid paths={BELL_ART.dome} tone="mid" crease="faint" />
        <Solid paths={BELL_ART.domeTop} tone="mid" crease="faint" />
        <g ref={hammer}>
          <Solid paths={BELL_ART.hammer} tone="hi" crease="faint" />
        </g>

        {/* The voice selector, and the speaker the voice comes out of. */}
        <Solid paths={BENCH_ART.sleeves[2]!} tone="mid" crease="none" />
        <Solid paths={SELECTOR_ART.box} tone="mid" crease="faint" />
        <Dots points={SELECTOR_ART.boxScrews} size={0.45} tone="mid" />
        <Solid paths={SELECTOR_ART.grille} tone="lo" crease="none" />
        <Line d={SELECTOR_ART.slots} tone="mid" />
        <Line d={SELECTOR_ART.detents} tone="mid" />
        <Solid paths={SELECTOR_ART.knobSkirt} tone="mid" crease="faint" />
        <Solid paths={SELECTOR_ART.knob} tone="mid" crease="none" inner={<Line d={SELECTOR_ART.knobSeams} tone="lo" />} />
        <Line d={SELECTOR_ART.knobKnurl} tone="lo" />
        <path className="iso-line" data-free="start" data-tone="lit" ref={knobPointer} />
      </svg>

      <span className="lp-corner" data-corner="hint">
        <span className="lp-hover">{t("landing.capabilities.art.voice.hint")}</span>
        <span className="lp-touch">{t("landing.capabilities.art.voice.hintTouch")}</span>
      </span>
      <span className="lp-corner" data-corner="readout" ref={readout} />
    </div>
  );
}
