"use client";

import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { AUDIO_ACCEPT_ATTRIBUTE } from "../../shared/living";
import type { Flipbook } from "../../shared/flipbook";
import type { FlipbookAudio } from "../../shared/sequence";
import styles from "./flipbook.module.css";

export function AudioPanel({ flipbook, disabled, onUpload, onSave, onRemove }: { flipbook: Flipbook; disabled: boolean; onUpload: (file: File) => void; onSave: (settings: Pick<FlipbookAudio, "offset" | "startsAt" | "volume">) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState({ offset: flipbook.audio?.offset ?? 0, startsAt: flipbook.audio?.startsAt ?? 0, volume: flipbook.audio?.volume ?? 1 });
  return <section className={styles.panel} aria-labelledby="audio-title">
    <h2 className={styles.panelTitle} id="audio-title">Audio</h2>
    <p className={styles.hint}>Add music or sound to this animation. MP4 includes the saved track; GIF and PNG exports are silent.</p>
    <div className={styles.buttonRow}>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>{flipbook.audio ? "Replace audio" : "Upload audio"}</Button>
      {flipbook.audio ? <Button size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>Remove audio</Button> : null}
    </div>
    <input ref={input} type="file" accept={AUDIO_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onUpload(file); }} />
    {flipbook.audio ? <>
      <p className={styles.hint}>{flipbook.audio.name} · {flipbook.audio.durationSeconds.toFixed(1)} s</p>
      <label className={styles.field}>Start within track (seconds)<input className={styles.fieldInput} type="number" min={0} max={Math.max(0, flipbook.audio.durationSeconds - 0.05)} step={0.05} value={settings.offset} disabled={disabled} onChange={(event) => setSettings({ ...settings, offset: Number(event.target.value) })} /></label>
      <label className={styles.field}>Start within clip (seconds)<input className={styles.fieldInput} type="number" min={0} max={flipbook.plan?.durationSeconds ?? 20} step={0.05} value={settings.startsAt} disabled={disabled} onChange={(event) => setSettings({ ...settings, startsAt: Number(event.target.value) })} /></label>
      <label className={styles.field}>Volume · {Math.round(settings.volume * 100)}%<input type="range" min={0} max={1} step={0.05} value={settings.volume} disabled={disabled} onChange={(event) => setSettings({ ...settings, volume: Number(event.target.value) })} /></label>
      <Button size="sm" disabled={disabled || settings.offset >= flipbook.audio.durationSeconds} onClick={() => onSave(settings)}>Save audio settings</Button>
      <p className={styles.hint}>Use “Preview audio” in the animation player to hear it in sync. Short tracks finish with silence; they never cut the video short.</p>
    </> : <p className={styles.hint}>MP3, M4A, AAC, WAV or OGG · up to 20 MB and 60 seconds.</p>}
  </section>;
}
