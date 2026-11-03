"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft01Icon, Download02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { rotoscopeUrls, type RotoscopeRunSummary } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import { rotoscopeApi } from "./rotoscope-client";
import styles from "./rotoscope.module.css";

type Source = "upload" | "run";
type Background = "scene" | "none";

/** A picked file shown as a picture until it is replaced. */
function usePicked() {
  const [file, setFile] = useState<File | null>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return { file, url, setFile };
}

function PickPicture({ label, picked }: { readonly label: string; readonly picked: ReturnType<typeof usePicked> }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.testPick}>
      <Button size="sm" variant="outline" onClick={() => input.current?.click()}>{picked.file ? `Change ${label}` : `Add ${label}`}</Button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { picked.setFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
      {picked.file ? <span className={fb.controlValue}>{picked.file.name}</span> : null}
    </div>
  );
}

/**
 * The prompt test (/rotoscope?test=…): a video frame and a character in, one drawing out, drawn with the run's own
 * prompt (the pose from the picture alone). The frame is uploaded or taken from a run; the drawing keeps the video's
 * background or comes back cut out. Nothing is checked or kept.
 */
export function RotoscopeTest() {
  const [runs, setRuns] = useState<RotoscopeRunSummary[] | null>(null);
  const [frameSource, setFrameSource] = useState<Source>("upload");
  const [characterSource, setCharacterSource] = useState<Source>("upload");
  const [runId, setRunId] = useState("");
  const [index, setIndex] = useState(1);
  const [background, setBackground] = useState<Background>("scene");
  const frame = usePicked();
  const character = usePicked();
  const [drawing, setDrawing] = useState<{ readonly image: string; readonly prompt: string; readonly background: Background } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void rotoscopeApi.list().then((list) => { setRuns(list); if (list[0]) setRunId(list[0].id); }, () => setRuns([])); }, []);
  const run = runs?.find((entry) => entry.id === runId) ?? null;
  const frames = run?.total ?? 0;
  const runFrame = run && index >= 1 && index <= frames ? rotoscopeUrls.media(run.id, "source", index) : null;
  const frameShown = frameSource === "upload" ? frame.url : runFrame;
  const ready = (frameSource === "upload" ? frame.file !== null : runFrame !== null) && (characterSource === "upload" ? character.file !== null : run !== null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (frameSource === "upload" && frame.file) form.set("frame", frame.file);
      if (frameSource === "run" || characterSource === "run") form.set("run", runId);
      if (frameSource === "run") form.set("index", String(index));
      if (characterSource === "upload" && character.file) form.set("character", character.file);
      form.set("background", background);
      setDrawing({ ...(await rotoscopeApi.test(form)), background });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.testPage}>
      <header className={styles.testHeader}>
        <Button size="sm" variant="ghost" asChild><Link href="/rotoscope"><HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />Rotoscope</Link></Button>
        <h1>Prompt test</h1>
        <p className={fb.controlValue}>A video frame and your character, drawn once with the same prompt as the runs. Nothing is checked or saved.</p>
      </header>

      <section className={styles.testControls}>
        <div className={fb.controlRow} role="group" aria-label="Video frame">
          <span className={fb.controlLabel}>Video frame</span>
          <ToggleChip size="xs" selected={frameSource === "upload"} onClick={() => setFrameSource("upload")}>Upload</ToggleChip>
          <ToggleChip size="xs" selected={frameSource === "run"} onClick={() => setFrameSource("run")} disabled={!runs?.length}>From a run</ToggleChip>
        </div>
        {frameSource === "upload" ? <PickPicture label="video frame" picked={frame} /> : null}

        {frameSource === "run" || characterSource === "run" ? (
          <div className={fb.controlRow}>
            <span className={fb.controlLabel}>Run</span>
            <Select aria-label="Run" value={runId} onValueChange={(value) => { setRunId(value); setIndex(1); }} options={(runs ?? []).map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.total} frames` }))} />
            {frameSource === "run" ? (
              <>
                <span className={fb.controlLabel}>Frame</span>
                <Input type="number" min={1} max={Math.max(1, frames)} value={index} onChange={(event) => setIndex(Math.max(1, Math.min(frames || 1, Number(event.target.value) || 1)))} className={styles.testFrame} aria-label="Frame number" />
                <span className={fb.controlValue}>of {frames}</span>
              </>
            ) : null}
          </div>
        ) : null}

        <div className={fb.controlRow} role="group" aria-label="Character">
          <span className={fb.controlLabel}>Character</span>
          <ToggleChip size="xs" selected={characterSource === "upload"} onClick={() => setCharacterSource("upload")}>Upload</ToggleChip>
          <ToggleChip size="xs" selected={characterSource === "run"} onClick={() => setCharacterSource("run")} disabled={!runs?.length} title="The run’s character sheet and its description.">The run’s character</ToggleChip>
        </div>
        {characterSource === "upload" ? <PickPicture label="character" picked={character} /> : null}

        <div className={fb.controlRow} role="group" aria-label="Background">
          <span className={fb.controlLabel}>Background</span>
          <ToggleChip size="xs" selected={background === "scene"} onClick={() => setBackground("scene")} title="The video frame’s room stays around the character.">Video background</ToggleChip>
          <ToggleChip size="xs" selected={background === "none"} onClick={() => setBackground("none")} title="The character alone, cut out on transparency.">No background</ToggleChip>
        </div>

        <div className={fb.controlRow}>
          <Button size="sm" disabled={!ready || busy} onClick={() => void generate()} title="One Muse Image picture.">
            {busy ? <Spinner className="size-3.5" /> : null}{busy ? "Drawing…" : "Generate"}
          </Button>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </section>

      <section className={styles.testResult}>
        <figure>
          <figcaption className={fb.controlLabel}>Video frame</figcaption>
          <div className={styles.testPicture}>{frameShown ? <img src={frameShown} alt="Video frame" /> : <span className={fb.controlValue}>No frame yet</span>}</div>
        </figure>
        <figure>
          <figcaption className={fb.controlLabel}>Drawing</figcaption>
          <div className={styles.testPicture} data-transparent={drawing?.background === "none" ? "" : undefined}>
            {busy ? <Spinner className="size-5" /> : drawing ? <img src={drawing.image} alt="Drawing" /> : <span className={fb.controlValue}>Generate to see it here</span>}
          </div>
          {drawing && !busy ? (
            <Button size="xs" variant="ghost" asChild><a href={drawing.image} download="rotoscope-test.png"><HugeiconsIcon icon={Download02Icon} size={13} strokeWidth={1.75} />PNG</a></Button>
          ) : null}
        </figure>
      </section>

      {drawing ? (
        <Disclosure title="The prompt Muse Image got">
          <pre className={styles.testPrompt}>{drawing.prompt}</pre>
        </Disclosure>
      ) : null}
    </main>
  );
}
