"use client";

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { DEFAULT_SEQUENCE, type SequenceSettings } from "../../shared/sequence";
import type { Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

export function SequenceFields({ value, onChange, disabled = false }: { value: SequenceSettings; onChange: (value: SequenceSettings) => void; disabled?: boolean }) {
  return <>
    <label className={styles.field}>Length · {value.durationSeconds} s
      <input type="range" min={1} max={20} step={1} value={value.durationSeconds} disabled={disabled} onChange={(event) => onChange({ ...value, durationSeconds: Number(event.target.value) })} aria-valuetext={`${value.durationSeconds} seconds`} />
    </label>
    <fieldset disabled={disabled} className={styles.field}>
      <legend className={styles.controlLabel}>Drawings per second</legend>
      <div className={styles.chips}>{([8, 12, 24] as const).map((drawingFps) => <ToggleChip key={drawingFps} size="xs" selected={value.drawingFps === drawingFps} onClick={() => onChange({ ...value, drawingFps })}>{drawingFps}</ToggleChip>)}</div>
    </fieldset>
    <p className={styles.hint} role="status">{value.durationSeconds * value.drawingFps} drawings across {value.durationSeconds} s. Increasing density adds drawings and keeps the movement’s timing. MP4 plays at 60 fps.</p>
  </>;
}

export function SequenceControls({ flipbook, disabled, onPlan, onRestore }: { flipbook: Flipbook; disabled: boolean; onPlan: (settings: SequenceSettings) => void; onRestore: (id: string) => void }) {
  const [value, setValue] = useState(flipbook.sequence ?? DEFAULT_SEQUENCE);
  const unchanged = flipbook.sequence?.durationSeconds === value.durationSeconds && flipbook.sequence.drawingFps === value.drawingFps;
  return <section className={styles.panel} aria-labelledby="sequence-title">
    <h2 id="sequence-title" className={styles.panelTitle}>Continuous sequence</h2>
    <SequenceFields value={value} onChange={setValue} disabled={disabled} />
    <Button size="sm" disabled={disabled || unchanged} onClick={() => onPlan(value)}>{flipbook.sequence ? "Update motion plan" : "Create a continuous motion plan"}</Button>
    <p className={styles.hint}>Plans the complete action first. Generate pending drawings when you are ready; changing these controls does not draw automatically.</p>
    {flipbook.revisions?.length ? <label className={styles.field}>Motion history
      <select className={styles.fieldInput} value="" disabled={disabled} onChange={(event) => { if (event.target.value) onRestore(event.target.value); }}>
        <option value="">Restore a previous motion…</option>
        {[...flipbook.revisions].reverse().map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.createdAt).toLocaleTimeString()} · {entry.plan.mode === "sequence" ? "Sequence" : "Cycle"} · {entry.plan.durationSeconds} s · {entry.frames.length} drawings</option>)}
      </select>
    </label> : null}
  </section>;
}
