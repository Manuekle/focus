"use client";

import { useState } from "react";
import { MediaImage } from "../../components/ui/media-image";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { rotoscopeUrls, type MappingView, type RotoscopeRun } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import styles from "./rotoscope.module.css";

type Picture = "overlay" | "build" | "scan";

const PICTURES: readonly { readonly id: Picture; readonly label: string; readonly note: string }[] = [
  { id: "overlay", label: "Overlay", note: "The drawing ghosted over its video frame on the grid, the picture Muse Spark reviews the pose with. Where the ghost and the person coincide the pose matches; the two bodies differ on purpose, only where each limb, hand and the head point and sit counts." },
  { id: "build", label: "Build", note: "The character (left) and the drawing (right) at one scale on the same grid: height and body build against the character’s measured profile, not the pose." },
  { id: "scan", label: "Error map", note: "The pose measured on the drawing against the video’s: target skeleton in green, the drawing’s in pink, bad cells outlined in red with what is wrong." },
];

/** What Muse Spark was shown for one attempt, and the pose error map: kept beside the attempt when it was reviewed. */
export function ReviewImages({ run, frame, attempt, review }: {
  readonly run: RotoscopeRun;
  readonly frame: number;
  readonly attempt: number;
  readonly review: MappingView["review"];
}) {
  const available = PICTURES.filter((picture) => review[picture.id]);
  const [chosen, setChosen] = useState<Picture>("overlay");
  if (!available.length) return null;
  const current = available.find((picture) => picture.id === chosen) ?? available[0];
  return (
    <div className="flex flex-col gap-2">
      <span className={fb.sectionLabel}>Review · attempt {attempt}</span>
      <div className={fb.chips} role="group" aria-label="Review pictures">
        {available.map((picture) => (
          <ToggleChip key={picture.id} size="xs" selected={picture.id === current.id} onClick={() => setChosen(picture.id)}>{picture.label}</ToggleChip>
        ))}
      </div>
      <div className={`${fb.inspect} ${styles.inspectFrame}`} data-transparent="">
        <div className={styles.mapBox}>
          <MediaImage src={rotoscopeUrls.media(run.id, current.id, frame, attempt)} alt={`${current.label} of attempt ${attempt}`} draggable={false} />
        </div>
      </div>
      <p className={fb.hint}>{current.note}</p>
    </div>
  );
}
