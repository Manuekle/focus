"use client";

import { useRef } from "react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { IMAGE_ACCEPT_ATTRIBUTE, flipbookUrls, type Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const KIND_LABEL = { original: "Your illustration", clean: "Clean side view", uploaded: "Uploaded reference" } as const;

/** The upload, the anchor every drawing is made from, and what Muse Spark saw. */
export function ReferencePanel({
  flipbook,
  busy,
  onReference,
  onUploadReference,
}: {
  readonly flipbook: Flipbook;
  readonly busy: boolean;
  readonly onReference: (kind: "original" | "clean") => void;
  readonly onUploadReference: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { analysis, reference } = flipbook;
  return (
    <section className={styles.panel} aria-labelledby="reference-title">
      <h2 id="reference-title" className={styles.panelTitle}>Character</h2>
      <div className={styles.referencePair} data-single={reference?.kind === "original" || undefined}>
        {reference?.kind !== "original" ? (
          <figure>
            <div className={styles.referenceImage}>
              {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
              <img src={flipbookUrls.source(flipbook.id)} alt="Your illustration" />
            </div>
            <figcaption>Original</figcaption>
          </figure>
        ) : null}
        <figure>
          <div className={styles.referenceImage}>
            {reference ? (
              // eslint-disable-next-line @next/next/no-img-element -- media route
              <img src={flipbookUrls.reference(flipbook.id, reference.version)} alt="Character reference used for every drawing" />
            ) : flipbook.status === "referencing" ? <Spinner className="size-4 text-muted-foreground" /> : <span className="text-xs text-muted-foreground">—</span>}
          </div>
          <figcaption>{reference ? <><HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2} /> Reference · {KIND_LABEL[reference.kind]}</> : "Reference"}</figcaption>
        </figure>
      </div>
      {reference ? <p className={styles.hint}>{reference.reason} Every drawing is made from this image.</p> : null}

      {flipbook.plan ? (
        <div className={styles.buttonRow}>
          <Button size="xs" variant="outline" disabled={busy || reference?.kind === "original"} onClick={() => onReference("original")}>Use original</Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => onReference("clean")} title="Muse Image draws a full-body side view from your illustration (1 drawing).">
            {reference?.kind === "clean" ? "Redraw clean view" : "Draw clean side view"}
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>Upload reference</Button>
          <input
            ref={fileRef} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onUploadReference(file);
            }}
          />
        </div>
      ) : null}
      {flipbook.frames.some((frame) => frame.version) && reference ? <p className={styles.hint}>A new reference applies to frames you redraw afterwards.</p> : null}

      {analysis ? (
        <dl className={styles.metrics}>
          <div><dt>Subject</dt><dd>{analysis.subject}</dd></div>
          <div><dt>View</dt><dd>{analysis.view.replace("_", " ")} · facing {analysis.facing}</dd></div>
          <div><dt>Walk</dt><dd>{flipbook.plan ? `facing ${flipbook.plan.direction}` : "—"}</dd></div>
        </dl>
      ) : null}
      {analysis?.palette.length ? (
        <div className={styles.palette} aria-label="Character palette">
          {analysis.palette.map((hex) => <span key={hex} style={{ background: hex }} title={hex} />)}
        </div>
      ) : null}
      {flipbook.warnings.length ? (
        <ul className={cn(styles.checkList, styles.caveats)} aria-label="Things that may affect the result">
          {flipbook.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

const STEPS = [
  { status: "analyzing", label: "Analyzing character" },
  { status: "planning", label: "Planning poses" },
  { status: "referencing", label: "Preparing reference" },
  { status: "generating", label: "Generating frames" },
  { status: "preparing", label: "Preparing sprites" },
  { status: "checking", label: "Checking consistency" },
] as const;

/** Real steps with real counts: no estimated percentage anywhere. */
export function ProgressSteps({ flipbook }: { readonly flipbook: Flipbook }) {
  const current = STEPS.findIndex((step) => step.status === flipbook.status);
  const done = flipbook.status === "ready";
  return (
    <ol className={styles.steps} aria-label="Progress">
      {STEPS.map((step, index) => {
        const state = done || (current >= 0 && index < current) ? "done" : index === current ? "active" : "todo";
        return (
          <li key={step.status} data-state={state} aria-current={state === "active" ? "step" : undefined}>
            <span className={styles.stepDot} aria-hidden>{state === "done" ? <HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={2.4} /> : state === "active" ? <Spinner className="size-3" /> : null}</span>
            <span>{step.label}</span>
            {state === "active" && flipbook.progress ? <span className="tabular-nums text-muted-foreground"> · {flipbook.progress.done}/{flipbook.progress.total}</span> : null}
          </li>
        );
      })}
      <li data-state={done ? "done" : "todo"}>
        <span className={styles.stepDot} aria-hidden>{done ? <HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={2.4} /> : null}</span>
        <span>Animation ready</span>
      </li>
    </ol>
  );
}
