"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ImageGenerationHandle } from "img-fx";
import { MediaImage } from "../../components/ui/media-image";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { flipbookUrls, type Flipbook, type FlipbookFrame } from "../../shared/flipbook";
import { ImageGeneration } from "../rotoscope/image-generation";
import styles from "./flipbook.module.css";

/**
 * Where one drawing is while the flipbook works: waiting its turn, being
 * drawn, drawn (its picture is there, the others are still being drawn), or
 * cut out (the cut-out runs once every drawing of the run exists).
 */
export type DrawStage = "queued" | "drawing" | "drawn" | "cutting";

export const STAGE_LABEL: Record<DrawStage, string> = { queued: "Queued", drawing: "Drawing", drawn: "Drawn", cutting: "Cutting out" };

export function drawStage(flipbook: Pick<Flipbook, "queuedDrawings" | "frames">, frame: Pick<FlipbookFrame, "id" | "status">): DrawStage | null {
  if (frame.status === "processing") return flipbook.frames.some((entry) => entry.status === "generating") ? "drawn" : "cutting";
  if (frame.status !== "generating") return null;
  return flipbook.queuedDrawings?.includes(frame.id) ? "queued" : "drawing";
}

/** The picture under the work: the drawing being replaced, or the character reference for a first drawing. */
export function ghostOf(flipbook: Flipbook, current: string | null): string | null {
  if (current) return current;
  return flipbook.reference ? flipbookUrls.reference(flipbook.id, flipbook.reference.version) : null;
}

/** The drawing as Muse Image made it, once it exists (a new version is written before it is cut out). */
const rawOf = (flipbook: Flipbook, frame: FlipbookFrame, stage: DrawStage) => ((stage === "cutting" || stage === "drawn") && frame.version ? flipbookUrls.raw(flipbook.id, frame.id, frame.version) : null);

/** A small card's worth of work: pixel churn over the old drawing, the new one as soon as it exists, and a flag saying where it is. */
export function FrameWorking({ flipbook, frame, stage, ghost }: {
  readonly flipbook: Flipbook;
  readonly frame: FlipbookFrame;
  readonly stage: DrawStage;
  readonly ghost: string | null;
}) {
  const drawn = rawOf(flipbook, frame, stage);
  return (
    <>
      {drawn ? (
        <MediaImage src={drawn} alt="" draggable={false} className={styles.checking} />
      ) : ghost && stage === "drawing" ? (
        <ImageGeneration className={styles.workingFx} preset="pixels-organic" pixelScale={0.6}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the drawing being replaced, dimmed under the work */}
          <img src={ghost} alt="" draggable={false} className={styles.ghost} />
        </ImageGeneration>
      ) : ghost ? (
        <MediaImage src={ghost} alt="" draggable={false} loading="lazy" decoding="async" className={styles.ghost} />
      ) : <Skeleton className={styles.working} />}
      <span className={styles.liveFlag} data-stage={stage}>
        {stage === "queued" || stage === "drawn" ? null : <Spinner className="size-2.5" />}
        {STAGE_LABEL[stage]}
      </span>
    </>
  );
}

/** The big version: the old drawing under the pixel churn, which dissolves into the new one once it is drawn. */
export function FrameWorkingLarge({ flipbook, frame, stage, ghost }: {
  readonly flipbook: Flipbook;
  readonly frame: FlipbookFrame;
  readonly stage: DrawStage;
  readonly ghost: string | null;
}) {
  const handle = useRef<ImageGenerationHandle>(null);
  const image = rawOf(flipbook, frame, stage);
  const images = useMemo(() => (image ? [image] : []), [image]);
  useEffect(() => {
    if (!image) return;
    handle.current?.triggerReveal({ hold: "manual" });
  }, [image]);
  return (
    <div className={styles.workingLarge} role="status" aria-label={`${frame.label}: ${STAGE_LABEL[stage].toLowerCase()}`}>
      {ghost ? (
        <ImageGeneration ref={handle} className={styles.workingLargeFx} preset="pixels-organic" borderRadius={12} images={images}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the drawing being replaced, dimmed under the work */}
          <img className={styles.workingLargeGhost} data-revealing={image ? "" : undefined} src={ghost} alt="" draggable={false} />
        </ImageGeneration>
      ) : <Skeleton className={styles.working} />}
      <span className={styles.workingStatus}>
        {stage === "queued" || stage === "drawn" ? null : <Spinner className="size-3.5" />}
        <span className="t-shimmer" data-text={STAGE_LABEL[stage]}>{stage === "queued" ? "Waiting for its turn" : STAGE_LABEL[stage]}</span>
      </span>
    </div>
  );
}
