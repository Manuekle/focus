"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { Button } from "../../components/ui/button";
import type { RenderParamsOf } from "../../shared/render";
import type { VideoAsset } from "../../shared/schemas";
import { triggerFrame } from "../../shared/temporal";
import type { TemporalSuggestion } from "../../shared/temporal-events";
import styles from "./freeze-timeline.module.css";

export type FreezeControl = {
  readonly trigger: RenderParamsOf<"time_freeze_echo">["trigger"];
  readonly suggestion: TemporalSuggestion | null;
  readonly invalid: boolean;
  readonly focus?: boolean;
  readonly onChange: (trigger: RenderParamsOf<"time_freeze_echo">["trigger"]) => void;
};

/** Two handles on one source clock: the freeze marker above, playback below. */
export function FreezeTimeline({ media, time, onSeek, control }: {
  readonly media: VideoAsset["normalized"];
  readonly time: number;
  readonly onSeek: (seconds: number) => void;
  readonly control: FreezeControl;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const { trigger, suggestion, invalid, onChange } = control;
  const last = media.frameCount - 1;
  const selected = trigger.timestampMs !== undefined;
  const frame = triggerFrame(trigger.timestampMs ?? 0, media);
  const current = triggerFrame(Math.round(time * 1000), media);
  const position = last > 0 ? frame / last : 0;
  const suggestedPosition = suggestion && last > 0 ? suggestion.frameIndex / last : 0;
  const eventLabel = suggestion?.event === "jump_apex" ? "jump apex" : "peak motion";
  const setFrame = (value: number) => {
    onChange({ mode: "manual", timestampMs: Math.floor(value * 1000 / media.fps) });
    onSeek(value / media.fps);
  };
  useEffect(() => {
    if (invalid || control.focus) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [invalid, control.focus]);

  return (
    <div className={styles.timeline} aria-label="Freeze point timeline">
      <div className={styles.readout}>
        <label htmlFor={id}>Freeze point</label>
        <output htmlFor={id}>{selected ? `${(frame / media.fps).toFixed(2)} s · frame ${frame + 1}` : "Not set"}</output>
      </div>
      <div className={styles.rails} style={{ "--point": position, "--suggestion": suggestedPosition } as CSSProperties}>
        {suggestion && trigger.mode === "manual" ? <span aria-hidden className={styles.suggestion} title="Suggested moment" /> : null}
        <input
          ref={ref} id={id} type="range" min={0} max={last} step={1} value={frame}
          onChange={(event) => setFrame(Number(event.currentTarget.value))}
          aria-valuetext={selected ? `${(frame / media.fps).toFixed(2)} seconds, frame ${frame + 1}, ${trigger.mode === "auto" ? "suggested" : "manual"}` : "Not set. Choose a freeze point."}
          aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
          data-unset={!selected || undefined} data-suggested={trigger.mode === "auto" || undefined}
          className={styles.marker}
        />
        {selected ? <span aria-hidden className={styles.pin} /> : null}
        <input
          type="range" min={0} max={last} step={1} value={current}
          onChange={(event) => onSeek(Number(event.currentTarget.value) / media.fps)}
          aria-label="Video position" aria-valuetext={`${(current / media.fps).toFixed(2)} seconds of the original clip`}
          className="editor-scrubber w-full" style={{ "--scrub": `${last > 0 ? current / last * 100 : 0}%` } as CSSProperties}
        />
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant="outline" onClick={() => setFrame(current)}>Freeze here</Button>
        {suggestion ? (
          <Button size="sm" variant="ghost" onClick={() => {
            onChange({ mode: "auto", event: suggestion.event, timestampMs: suggestion.timestampMs });
            onSeek(suggestion.frameIndex / media.fps);
          }}>Use suggestion</Button>
        ) : null}
        <span className="text-xs text-muted-foreground">{trigger.mode === "auto" ? "Suggested point" : selected ? "Manual point" : "Original clip"}</span>
      </div>
      {suggestion ? <p className={styles.hint}>Suggested {eventLabel} · {Math.round(suggestion.confidence * 100)}% confidence. Review and adjust the marker.</p> : null}
      <p id={`${id}-hint`} className={styles.hint} data-invalid={invalid || undefined}>
        {invalid ? "Choose a freeze point before previewing." : "Seek, then choose Freeze here. Drag the diamond or use the arrow keys to adjust."}
      </p>
    </div>
  );
}
