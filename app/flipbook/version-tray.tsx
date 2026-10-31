"use client";

import { MediaImage } from "../../components/ui/media-image";
import { flipbookUrls, type Flipbook, type FlipbookFrame } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const SOURCE_LABEL: Record<FlipbookFrame["versions"][number]["source"], string> = {
  generated: "drawn",
  enhanced: "improved",
  uploaded: "your upload",
  imported: "imported",
  skeleton: "moved from the video",
};

/**
 * Every drawing this frame has had, newest first, in one row that scrolls
 * sideways. A dot marks the one in the animation; the ringed one is the one
 * being looked at.
 */
export function VersionTray({ flipbook, frame, shown, onPick }: {
  readonly flipbook: Flipbook;
  readonly frame: FlipbookFrame;
  /** The version the inspector shows. */
  readonly shown: string | null;
  readonly onPick: (version: string) => void;
}) {
  const items = [...frame.versions].reverse();
  return (
    <div className={styles.versions} role="group" aria-label={`${items.length} drawings of this frame`}>
      {items.map((version, position) => {
        const number = items.length - position;
        const label = `Drawing ${number}, ${SOURCE_LABEL[version.source]}${version.id === frame.version ? ", in the animation" : ""}${version.note ? `: ${version.note}` : ""}`;
        return (
          <button
            key={version.id}
            type="button"
            className={styles.version}
            data-shown={version.id === shown}
            data-current={version.id === frame.version}
            aria-pressed={version.id === shown}
            aria-label={label}
            title={label}
            onClick={() => onPick(version.id)}
          >
            <span className={styles.versionThumb}>
              <MediaImage src={flipbookUrls.raw(flipbook.id, frame.id, version.id)} alt="" draggable={false} loading="lazy" decoding="async" />
            </span>
            <span className={styles.versionNumber}>{number}</span>
          </button>
        );
      })}
    </div>
  );
}
