/**
 * The truth behind Fig 05.5, kept apart from the drawing so what the card
 * shows and what it says come from one place.
 *
 * What the product does (`lib/elevenlabs-agents.ts`). An agent that speaks has
 * a mirror agent on ElevenLabs: `syncVoiceAgent` pushes this app's prompt, the
 * voice chosen for it and its first message, so the phone is answered by the
 * same agent. ElevenLabs runs the whole listen–think–speak loop at phone
 * latency on a flash voice model, the agent hangs up with `end_call` when the
 * conversation is over, and the `post_call_transcription` webhook (signed, and
 * checked) brings back the transcript, turn by turn, to be kept with the call.
 *
 * The drawing is a desk telephone wired to a kymograph. When a call comes in
 * the bell rings and the handset lifts by itself; the drum turns once for the
 * call while two pens write it — the caller's on the upper line, the agent's
 * below in the shape of the chosen voice — and when the agent hangs up the
 * band stays on the sheet. A full sheet is filed.
 */

/** The voices on the selector. Each writes its own shape on the agent's line. */
export const VOICES = [
  { name: "Sofía", wave: "sine" },
  { name: "Diego", wave: "low" },
  { name: "Valeria", wave: "bright" },
  { name: "Andrés", wave: "pulse" },
] as const;
export type Wave = (typeof VOICES)[number]["wave"];

/** Calls a sheet holds, one band each, before it is filed. */
export const BANDS = 3;

/** Who speaks, for how much of the drum's turn: a call is one turn of the drum. */
export const TURNS: readonly { readonly who: "caller" | "agent"; readonly share: number }[] = [
  { who: "caller", share: 0.16 },
  { who: "agent", share: 0.24 },
  { who: "caller", share: 0.13 },
  { who: "agent", share: 0.27 },
  { who: "caller", share: 0.08 },
  { who: "agent", share: 0.12 },
];

/** Who has the line at `share` (0–1) of the call. */
export function speakerAt(share: number): "caller" | "agent" {
  let at = 0;
  for (const turn of TURNS) {
    at += turn.share;
    if (share < at) return turn.who;
  }
  return TURNS[TURNS.length - 1]!.who;
}

/** A line's height off its rest, at `angle` (radians round the drum), while its speaker talks. */
export function waveAt(wave: Wave | "caller", angle: number) {
  const a = angle * 9;
  switch (wave) {
    case "sine":
      return Math.sin(a);
    case "low":
      return 0.8 * Math.sin(a * 0.55) + 0.2 * Math.sin(a * 2.2);
    case "bright":
      return 0.65 * Math.sin(a * 1.8) + 0.35 * Math.sin(a * 4.1);
    case "pulse":
      return Math.tanh(3 * Math.sin(a * 0.9)) * 0.9;
    case "caller":
      return 0.6 * Math.sin(a * 1.3 + 1) + 0.4 * Math.sin(a * 3.7 + 0.4) * Math.sin(a * 0.31);
  }
}

/** Seconds for each part of a call, on the page. */
export const RING = 1.3;
export const PICKUP = 0.5;
export const TALK = 6.2;
export const HANGUP = 0.5;
export const PAUSE = 1.1;
export const CALL = RING + PICKUP + TALK + HANGUP + PAUSE;
