"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Checkbox } from "radix-ui";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Input } from "../../components/ui/input";
import { VideoPlayer } from "../../components/ui/video-player";
import { rotoscopeEnabled } from "../../shared/features";
import type { Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

export function MotionReferencePanel({ flipbook, disabled, onUpload, onAttach }: { flipbook: Flipbook; disabled: boolean; onUpload: (file: File) => void; onAttach: (input: { version: string; start: number; durationSeconds: number; useAudio: boolean }) => void }) {
  const reference = flipbook.motionDraft ?? flipbook.motionReference;
  const input = useRef<HTMLInputElement>(null);
  const [start, setStart] = useState(reference?.start ?? 0);
  const [seconds, setSeconds] = useState(Math.min(flipbook.sequence?.durationSeconds ?? 4, reference?.durationSeconds ?? 4));
  const [useAudio, setUseAudio] = useState(false);
  const valid = Boolean(reference && Number.isFinite(start) && start >= 0 && Number.isInteger(seconds) && seconds >= 1 && seconds <= 20 && start + seconds <= reference.sourceSeconds + 0.001);
  return <section className={styles.panel} aria-labelledby="motion-reference-title">
    <h2 className={styles.panelTitle} id="motion-reference-title">Video movement reference</h2>
    <p className={styles.hint}>Upload yourself dancing or performing an action. The video guides posture and timing; your illustration defines the character. You keep an editable animation, not a frame-by-frame copy of the video.</p>
    {rotoscopeEnabled() ? <p className={styles.hint}>Prefer to check the character frame by frame first? <Link href="/rotoscope" className="text-primary hover:underline">Test the video in Rotoscope</Link>, then open its approved frames here.</p> : null}
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>{reference ? "Replace reference video" : "Upload reference video"}</Button>
    <input ref={input} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onUpload(file); }} />
    {reference ? <>
      <p className={styles.hint}>{reference.name} · {reference.sourceSeconds.toFixed(1)} s</p>
      <VideoPlayer src={`/api/flipbooks/${flipbook.id}/motion?v=${reference.version}`} label="Movement reference preview" hasAudio={reference.hasAudio} segment={valid ? { start, durationSeconds: seconds } : undefined} />
      <label className={styles.controlField}><span className={styles.controlLabel}>Start in reference (seconds)</span><Input type="number" min={0} max={Math.max(0, reference.sourceSeconds - seconds)} step={0.05} value={start} disabled={disabled} onChange={(event) => setStart(Number(event.target.value))} /></label>
      <label className={styles.controlField}><span className={styles.controlLabel}>Segment length (whole seconds)</span><Input type="number" min={1} max={Math.min(20, Math.floor(reference.sourceSeconds))} value={seconds} disabled={disabled} onChange={(event) => setSeconds(Number(event.target.value))} /></label>
      {reference.hasAudio ? <label className={styles.inline} htmlFor="motion-use-audio"><Checkbox.Root className={styles.checkbox} checked={useAudio} disabled={disabled} onCheckedChange={(checked) => setUseAudio(checked === true)} id="motion-use-audio"><HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.5} /></Checkbox.Root>Use audio from this segment</label> : null}
      <Button size="sm" disabled={disabled || !valid} onClick={() => onAttach({ version: reference.version, start, durationSeconds: seconds, useAudio })}>Plan movement from this segment</Button>
      <p className={styles.hint}>{seconds * (flipbook.sequence?.drawingFps ?? 24)} drawings. The current motion stays in history. This plans the movement; drawing starts when you choose “Generate”.</p>
      {!valid ? <p role="status" className={styles.hint}>Choose a segment entirely inside the video, lasting 1–20 whole seconds.</p> : null}
    </> : null}
    <p className={styles.hint}>Use one clearly visible person and a fixed camera. This guides animation; visual fidelity needs review after generation.</p>
  </section>;
}
