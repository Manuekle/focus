"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "@/app/_components/chat/chat-input";
import { VoiceBeamGlow } from "@/components/ui/voice-beam";

/**
 * Contact sheet for the voice glow, in the same spirit as /dev/goo: the effect
 * only shows while the microphone is open or the agent is working, so neither
 * state is reachable from an idle composer. Here both are pinned.
 *
 * The third card drives the beam off a slider instead of audio — the `level`
 * prop takes a getter, which is sampled once a frame, so dragging it never
 * re-renders the card.
 */
export default function VoiceContactSheet() {
  const [level, setLevel] = useState(0.4);
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  // Stable identity on purpose: a fresh arrow on every render restarts the
  // package's driver, which is the opposite of what the getter API is for.
  const readLevel = useCallback(() => levelRef.current, []);

  return (
    <div className="min-h-dvh bg-background p-10 text-foreground">
      <h1 className="text-lg font-medium">Voice glow</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        El brillo vive en el borde inferior del composer: reacciona al micrófono
        mientras escucha y se junta en un haz mientras el agente trabaja.
      </p>

      <div className="mt-10 max-w-2xl space-y-12">
        <div>
          <div className="mb-3 font-mono text-[11px] text-muted-foreground">
            ChatInput — en reposo (sin efecto hasta pulsar el micro)
          </div>
          <ChatInput onSubmit={() => {}} onStop={() => {}} isBusy={false} />
        </div>

        <div>
          <div className="mb-3 font-mono text-[11px] text-muted-foreground">
            ChatInput — isBusy (haz de procesamiento)
          </div>
          <ChatInput onSubmit={() => {}} onStop={() => {}} isBusy />
        </div>

        <div>
          <div className="mb-3 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span>level = {level.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              aria-label="level"
            />
          </div>
          <VoiceBeamGlow level={readLevel}>
            <div className="rounded-[20px] border border-border/70 bg-card p-6 text-sm text-muted-foreground">
              Cualquier tarjeta, con el nivel en la mano.
            </div>
          </VoiceBeamGlow>
        </div>
      </div>
    </div>
  );
}
