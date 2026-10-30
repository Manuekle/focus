"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { VideoPlayer } from "../../components/ui/video-player";
import { rotoscopeEnabled } from "../../shared/features";
import { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, formatBytes } from "../../shared/media";
import styles from "./flipbook.module.css";

export type MotionVideoSelection = { file: File; sourceSeconds: number; start: number; durationSeconds: number; useAudio: boolean };
export function validMotionVideo(value: MotionVideoSelection | undefined): boolean {
  return Boolean(value && value.sourceSeconds >= 1 && Number.isFinite(value.start) && value.start >= 0 && Number.isInteger(value.durationSeconds) && value.durationSeconds >= 1 && value.durationSeconds <= 20 && value.start + value.durationSeconds <= value.sourceSeconds + 0.001);
}

export function MotionVideoInput({ value, disabled, onChange }: { value: MotionVideoSelection | undefined; disabled: boolean; onChange: (value: MotionVideoSelection | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const file = value?.file;
  useEffect(() => {
    if (!file) { setUrl(undefined); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const choose = (file: File) => {
    setError(undefined);
    if (!/\.(mp4|mov)$/i.test(file.name) || file.size > MAX_UPLOAD_BYTES) {
      onChange(undefined);
      setError(`Choose an MP4 or MOV file smaller than ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    onChange({ file, sourceSeconds: 0, start: 0, durationSeconds: 4, useAudio: false });
  };
  return <div className={styles.controlField}>
    <p className={styles.hint}>Use one clearly visible person. The selected segment supplies the movement, timing and orientation; your illustration supplies the character. The result stays editable: this is not a frame-by-frame copy of the video.</p>
    {rotoscopeEnabled() ? <p className={styles.hint}>Not sure the character will hold up? <Link href="/rotoscope" className="text-primary hover:underline">Test it in Rotoscope first</Link>, a frame-by-frame sandbox that opens its result here.</p> : null}
    <div className={styles.buttonRow}>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>{value ? "Replace reference video" : "Choose reference video"}</Button>
      {value ? <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { onChange(undefined); setError(undefined); }}>Remove video</Button> : null}
    </div>
    <input ref={input} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" disabled={disabled} className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) choose(file); }} />
    {value ? <>
      <p className={styles.uploadName}>{value.file.name}</p>
      {url ? <VideoPlayer src={url} label="Movement reference preview" segment={validMotionVideo(value) ? value : undefined} onLoadedMetadata={(event) => {
        const duration = event.currentTarget.duration;
        if (!Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION_SECONDS + 0.1) {
          onChange(undefined); setError(`Choose a video lasting 1–${MAX_DURATION_SECONDS} seconds.`); return;
        }
        event.currentTarget.currentTime = value.start;
        onChange({ ...value, sourceSeconds: duration, durationSeconds: Math.min(value.durationSeconds, Math.floor(duration), 20) });
      }} onError={() => { onChange(undefined); setError("This video could not be read. Choose another MP4 or MOV file."); }} /> : null}
      {value.sourceSeconds > 0 ? <>
        <div className={styles.createFraming}>
          <label className={styles.controlField}><span className={styles.controlLabel}>Start in reference (seconds)</span><Input type="number" min={0} max={Math.max(0, value.sourceSeconds - value.durationSeconds)} step={0.05} value={value.start} disabled={disabled} onChange={(event) => onChange({ ...value, start: Number(event.target.value) })} /></label>
          <label className={styles.controlField}><span className={styles.controlLabel}>Segment length (whole seconds)</span><Input type="number" min={1} max={Math.min(20, Math.floor(value.sourceSeconds - value.start))} step={1} value={value.durationSeconds} disabled={disabled} onChange={(event) => onChange({ ...value, durationSeconds: Number(event.target.value) })} /></label>
        </div>
        <label className={styles.keepScene}><span className={styles.controlLabel}>Use audio from the video if available</span><Switch checked={value.useAudio} onCheckedChange={(useAudio) => onChange({ ...value, useAudio })} disabled={disabled} label="Use audio from the video if available" /></label>
        <p className={styles.hint}>{value.sourceSeconds.toFixed(2)} s available. The animation keeps the selected segment’s original timing.</p>
        {!validMotionVideo(value) ? <p className={styles.hint} data-invalid="" role="status">Choose a segment entirely inside the video, lasting 1–20 whole seconds.</p> : null}
      </> : <p className={styles.hint} role="status">Reading video…</p>}
    </> : null}
    {error ? <p className={styles.hint} data-invalid="" role="alert">{error}</p> : null}
  </div>;
}
