"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { DEFAULT_SEQUENCE, type SequenceSettings } from "../../shared/sequence";
import type { Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

export function SequenceFields({ value, onChange, disabled = false }: { value: SequenceSettings; onChange: (value: SequenceSettings) => void; disabled?: boolean }) {
  const lengthLabel = useId();
  const hint = useId();
  return <>
    <div className={styles.controlField}>
      <div className={styles.controlHeading}><span id={lengthLabel} className={styles.controlLabel}>Length</span><output className={styles.controlValue}>{value.durationSeconds} s</output></div>
      <Slider min={1} max={20} step={1} value={[value.durationSeconds]} disabled={disabled} onValueChange={([durationSeconds]) => { if (durationSeconds !== undefined) onChange({ ...value, durationSeconds }); }} aria-labelledby={lengthLabel} aria-describedby={hint} aria-valuetext={`${value.durationSeconds} seconds`} />
    </div>
    <fieldset disabled={disabled} className={styles.controlField} aria-describedby={hint}>
      <legend className={styles.controlLabel}>Drawings per second</legend>
      <div className={styles.chips}>{([8, 12, 24] as const).map((drawingFps) => <Button type="button" key={drawingFps} size="sm" className="flex-1" variant={value.drawingFps === drawingFps ? "default" : "outline"} aria-pressed={value.drawingFps === drawingFps} disabled={disabled} onClick={() => onChange({ ...value, drawingFps })}>{drawingFps}</Button>)}</div>
    </fieldset>
    <p id={hint} className={styles.hint} role="status">{value.durationSeconds * value.drawingFps} drawings across {value.durationSeconds} s. Increasing density adds drawings and keeps the movement’s timing. A drawing can stay unchanged for up to 125 ms; longer holds are flagged for correction. MP4 plays at 60 fps.</p>
  </>;
}

export function SequenceControls({ flipbook, disabled, onPlan, onRestore }: { flipbook: Flipbook; disabled: boolean; onPlan: (settings: SequenceSettings) => void; onRestore: (id: string) => void }) {
  const [value, setValue] = useState(flipbook.sequence ?? DEFAULT_SEQUENCE);
  const unchanged = flipbook.sequence?.durationSeconds === value.durationSeconds && flipbook.sequence.drawingFps === value.drawingFps;
  const revisions = useMemo(() => [...(flipbook.revisions ?? [])].reverse(), [flipbook.revisions]);
  return <section className={styles.panel} aria-labelledby="sequence-title">
    <h2 id="sequence-title" className={styles.panelTitle}>Continuous sequence</h2>
    <SequenceFields value={value} onChange={setValue} disabled={disabled} />
    <Button size="sm" disabled={disabled || unchanged} onClick={() => onPlan(value)}>{flipbook.status === "planning" ? "Updating motion plan…" : flipbook.sequence ? "Update motion plan" : "Create a continuous motion plan"}</Button>
    {flipbook.sequence && flipbook.sequence.durationSeconds !== value.durationSeconds ? <p className={styles.hint}>Changing length replans the full movement and needs new drawings. The current motion stays in Motion history.</p> : null}
    <p className={styles.hint}>Plans the complete action first. Generate pending drawings when you are ready; changing these controls does not draw automatically.</p>
    {revisions.length ? <div className={styles.controlField}>
      <label className={styles.controlLabel} htmlFor="motion-history-select">Motion history</label>
      <Select
        id="motion-history-select"
        value=""
        disabled={disabled}
        placeholder="Restore a previous motion…"
        aria-label="Motion history"
        options={revisions.map((entry) => ({ value: entry.id, label: `${new Date(entry.createdAt).toLocaleTimeString()} · ${entry.plan.mode === "sequence" ? "Sequence" : "Cycle"} · ${entry.frames.length} drawings` }))}
        onValueChange={(id) => { if (id) onRestore(id); }}
      />
    </div> : null}
  </section>;
}
