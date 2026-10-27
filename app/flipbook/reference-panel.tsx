"use client";

import { useRef, useState } from "react";
import { AiExpandIcon, Cancel01Icon, OrientationImageLandscapeToPotraitIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { MediaLightbox, ZoomButton, type LightboxMedia } from "../../components/ui/media-lightbox";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { IMAGE_ACCEPT_ATTRIBUTE, MAX_EXTRA_REFERENCES, actionSpec, flipbookUrls, type Flipbook } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const KIND_LABEL = { original: "Your illustration", clean: "Clean side view", uploaded: "Uploaded reference" } as const;

/** The upload, the anchor every drawing is made from, and what Muse Spark saw. */
export function ReferencePanel({
  flipbook,
  busy,
  onReference,
  onUploadReferences,
  onRemoveReference,
}: {
  readonly flipbook: Flipbook;
  readonly busy: boolean;
  readonly onReference: (kind: "original" | "clean") => void;
  /** Files picked together. `asAnchor`: the first becomes the main reference, the rest extra views. Otherwise all are extra views. */
  readonly onUploadReferences: (files: File[], asAnchor: boolean) => void;
  readonly onRemoveReference: (version: string) => void;
}) {
  const anchorRef = useRef<HTMLInputElement>(null);
  const extraRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const { analysis, reference, extraReferences } = flipbook;
  const room = MAX_EXTRA_REFERENCES - extraReferences.length;

  const sourceItem: LightboxMedia = { kind: "image", src: flipbookUrls.source(flipbook.id), alt: "Your illustration", caption: "Original illustration" };
  const items: LightboxMedia[] = [
    ...(reference?.kind !== "original" ? [sourceItem] : []),
    ...(reference ? [{ kind: "image" as const, src: flipbookUrls.reference(flipbook.id, reference.version), alt: "Character reference used for every drawing", caption: `Reference · ${KIND_LABEL[reference.kind]}` }] : []),
    ...extraReferences.map((extra, position) => ({ kind: "image" as const, src: flipbookUrls.extraReference(flipbook.id, extra.version), alt: `Extra reference ${position + 1}`, caption: `Extra reference · ${extra.name}` })),
  ];
  const originalAt = reference?.kind !== "original" ? 0 : -1;
  const referenceAt = reference ? (reference.kind !== "original" ? 1 : 0) : -1;
  const extraAt = (position: number) => referenceAt + 1 + position;

  const pick = (asAnchor: boolean) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (files.length) onUploadReferences(files, asAnchor);
  };

  return (
    <section className={styles.panel} aria-labelledby="reference-title">
      <h2 id="reference-title" className={styles.panelTitle}>Character</h2>
      <div className={styles.referencePair} data-single={reference?.kind === "original" || undefined}>
        {reference?.kind !== "original" ? (
          <figure>
            <ZoomButton className={styles.referenceImage} label="Open your illustration larger" onOpen={() => setZoom(originalAt)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
              <img src={flipbookUrls.source(flipbook.id)} alt="Your illustration" />
            </ZoomButton>
            <figcaption>Original</figcaption>
          </figure>
        ) : null}
        <figure>
          {reference ? (
            <ZoomButton className={styles.referenceImage} label="Open the character reference larger" onOpen={() => setZoom(referenceAt)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
              <img src={flipbookUrls.reference(flipbook.id, reference.version)} alt="Character reference used for every drawing" />
            </ZoomButton>
          ) : (
            <div className={styles.referenceImage}>
              {flipbook.status === "referencing" ? <Skeleton className={styles.working} /> : <span className="text-xs text-muted-foreground">—</span>}
            </div>
          )}
          <figcaption>{reference ? <><HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2} /> Reference · {KIND_LABEL[reference.kind]}</> : "Reference"}</figcaption>
        </figure>
      </div>
      {reference ? <p className={styles.hint}>{reference.reason} Every drawing is made from this image.</p> : null}

      {extraReferences.length ? (
        <div className={styles.extras} role="list" aria-label="Extra references">
          {extraReferences.map((extra, position) => (
            <div key={extra.version} className={styles.extra} role="listitem">
              <ZoomButton className={styles.extraImage} label={`Open ${extra.name} larger`} onOpen={() => setZoom(extraAt(position))}>
                {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
                <img src={flipbookUrls.extraReference(flipbook.id, extra.version)} alt={extra.name} />
              </ZoomButton>
              <button type="button" className={styles.extraRemove} aria-label={`Remove ${extra.name}`} disabled={busy} onClick={() => onRemoveReference(extra.version)}>
                <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {flipbook.plan ? (
        <div className={styles.buttonRow}>
          <Button size="xs" variant="outline" disabled={busy || reference?.kind === "original"} onClick={() => onReference("original")}>Use original</Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => onReference("clean")} title="Muse Image draws a full-body side view from your illustration and your extra references (1 drawing).">
            {reference?.kind === "clean" ? "Redraw clean view" : "Draw clean side view"}
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => anchorRef.current?.click()} title={`Pick one or more images: the first becomes the reference, the others (up to ${room}) are kept as extra views.`}>
            <HugeiconsIcon icon={OrientationImageLandscapeToPotraitIcon} size={12} strokeWidth={1.75} />Upload references
          </Button>
          {reference ? (
            <Button size="xs" variant="ghost" disabled={busy || room <= 0} onClick={() => extraRef.current?.click()} title={room > 0 ? `Another angle or the back of the outfit. ${room} more fit.` : `Up to ${MAX_EXTRA_REFERENCES} extra views. Remove one to add another.`}>
              <HugeiconsIcon icon={AiExpandIcon} size={12} strokeWidth={1.75} />Add views{extraReferences.length ? ` (${extraReferences.length}/${MAX_EXTRA_REFERENCES})` : ""}
            </Button>
          ) : null}
          <input ref={anchorRef} type="file" multiple accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden onChange={pick(true)} />
          <input ref={extraRef} type="file" multiple accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden onChange={pick(false)} />
        </div>
      ) : null}
      {extraReferences.length ? <p className={styles.hint}>Extra views travel with every drawing, so hidden details (the back of the outfit, an accessory) stay right.</p> : null}
      {flipbook.frames.some((frame) => frame.version) && reference ? <p className={styles.hint}>A new reference applies to frames you redraw afterwards.</p> : null}

      <MediaLightbox items={items} index={zoom !== null && zoom >= 0 ? zoom : null} onIndexChange={setZoom} onClose={() => setZoom(null)} />

      {analysis ? (
        <dl className={styles.metrics}>
          <div><dt>Subject</dt><dd>{analysis.subject}</dd></div>
          <div><dt>View</dt><dd>{analysis.view.replace("_", " ")} · facing {analysis.facing}</dd></div>
          <div><dt>Motion</dt><dd>{flipbook.plan ? `${actionSpec(flipbook.plan.action).label} · facing ${flipbook.plan.direction}` : "—"}</dd></div>
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
