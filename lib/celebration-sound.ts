/** A soft paper pop and an ascending, warm chime for successful celebrations.
 *  Its own context is primed silently during the user's gesture, before an
 *  async request can lose Safari's permission to start audio. */
const SILENT = 0.0001;
const NOTES = [523.25, 659.25, 783.99, 1046.5] as const;
let context: AudioContext | null = null;
let primed = false;
let generation = 0;
const outputs = new Set<GainNode>();

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context || context.state === "closed") {
    context = new Ctor();
    primed = false;
  }
  return context;
}

/** No audible cue: a one-sample buffer unlocks iOS audio from a real gesture. */
export function prepareCelebrationAudio(): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (!primed) {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.onended = () => source.disconnect();
      source.start();
      primed = true;
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  } catch {
    // Unsupported/blocked audio must never break the action being celebrated.
  }
}

/** Also cancels a resume still waiting for browser permission. */
export function stopCelebrationSound(): void {
  generation++;
  for (const output of outputs) {
    output.gain.value = 0;
    output.disconnect();
  }
  outputs.clear();
}

function render(ctx: AudioContext, volume: number) {
  const start = ctx.currentTime + 0.008;
  const master = ctx.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume));
  master.connect(ctx.destination);
  outputs.add(master);
  let remaining = NOTES.length * 2 + 1;
  const release = (source: OscillatorNode, envelope: GainNode) => {
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      if (--remaining === 0) {
        master.disconnect();
        outputs.delete(master);
      }
    };
  };
  const tone = (frequency: number, at: number, peak: number, decay: number, end?: number) => {
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(SILENT, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(SILENT, at + decay);
    const source = ctx.createOscillator();
    source.type = "sine";
    source.frequency.setValueAtTime(frequency, at);
    if (end) source.frequency.exponentialRampToValueAtTime(end, at + decay);
    source.connect(envelope).connect(master);
    release(source, envelope);
    source.start(at);
    source.stop(at + decay + 0.03);
  };
  // A rounded transient, then staggered fundamentals with quiet upper
  // partials. No harsh noise, borrowed audio asset or long musical fanfare.
  tone(320, start, 0.2, 0.065, 120);
  NOTES.forEach((frequency, index) => {
    const at = start + 0.035 + index * 0.065;
    tone(frequency, at, 0.14 - index * 0.018, 0.32 + index * 0.025);
    tone(frequency * 2, at + 0.009, 0.025, 0.2);
  });
}

export function playCelebration(volume: number): void {
  if (!Number.isFinite(volume) || volume <= 0) return;
  try {
    const ctx = getContext();
    if (!ctx) return;
    const current = generation;
    const play = () => {
      if (current !== generation || ctx.state !== "running") return;
      try { render(ctx, volume); } catch { /* A cue cannot break a success. */ }
    };
    if (ctx.state === "running") play();
    else void ctx.resume().then(play, () => {});
  } catch {
    // The visual and static success feedback remain available without audio.
  }
}
