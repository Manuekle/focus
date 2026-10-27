"use client";

import { useRef } from "react";
import { Download01Icon, Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { formatBytes } from "../../shared/media";
import {
  DURATIONS,
  IMAGE_ACCEPT_ATTRIBUTE,
  holdFrames,
  type ExportFormat,
  type Flipbook,
  type FlipbookBackground,
  type PlaybackSettings,
} from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const FORMAT_LABEL: Record<ExportFormat, string> = { mp4: "MP4", gif: "GIF", spritesheet: "Sprite sheet", frames: "PNG frames" };

/** Which backgrounds a format can carry. MP4 is never offered as transparent. */
export function backgroundAllowed(format: ExportFormat, kind: FlipbookBackground["kind"]): boolean {
  if (format === "mp4") return kind !== "transparent";
  if (format === "spritesheet" || format === "frames") return kind === "transparent" || kind === "color";
  return true;
}

export function ExportPanel({
  flipbook,
  settings,
  onSettingsChange,
  format,
  onFormatChange,
  background,
  onBackgroundChange,
  exportable,
  exporting,
  onExport,
  onCreateScene,
  creatingScene,
  onUploadBackground,
}: {
  readonly flipbook: Flipbook;
  readonly settings: PlaybackSettings;
  readonly onSettingsChange: (settings: PlaybackSettings) => void;
  readonly format: ExportFormat;
  readonly onFormatChange: (format: ExportFormat) => void;
  readonly background: FlipbookBackground;
  readonly onBackgroundChange: (background: FlipbookBackground) => void;
  readonly exportable: { ok: true } | { ok: false; reason: string };
  readonly exporting: boolean;
  readonly onExport: () => void;
  readonly onCreateScene: () => void;
  readonly creatingScene: boolean;
  readonly onUploadBackground: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const color = background.kind === "color" ? background.color : "#ffffff";
  const timed = format === "mp4" || (format === "gif" && settings.motion !== "in_place");
  const sceneOffered = flipbook.analysis?.background !== "plain";
  const allowed = backgroundAllowed(format, background.kind);
  const latest = flipbook.exports.slice(0, 6);

  return (
    <section className={styles.panel} aria-labelledby="export-title">
      <h2 id="export-title" className={styles.panelTitle}>Export</h2>

      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>Format</span>
        <div className={styles.chips}>
          {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((value) => (
            <ToggleChip key={value} size="xs" selected={format === value} onClick={() => onFormatChange(value)}>{FORMAT_LABEL[value]}</ToggleChip>
          ))}
        </div>
      </div>

      {timed ? (
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Length</span>
          <div className={styles.chips}>
            {DURATIONS.map((value) => (
              <ToggleChip key={value} size="xs" selected={settings.durationSeconds === value} onClick={() => onSettingsChange({ ...settings, durationSeconds: value })}>{value} s</ToggleChip>
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.hint}>{format === "gif" ? "One cycle that loops forever." : "One cycle, eight drawings, with frame order and timing."}</p>
      )}

      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>Background</span>
        <div className={styles.chips}>
          <ToggleChip size="xs" selected={background.kind === "transparent"} disabled={!backgroundAllowed(format, "transparent")} onClick={() => onBackgroundChange({ kind: "transparent" })}>Transparent</ToggleChip>
          <ToggleChip size="xs" selected={background.kind === "color"} onClick={() => onBackgroundChange({ kind: "color", color })}>Color</ToggleChip>
          {background.kind === "color" ? (
            <input type="color" className={styles.color} value={color} onChange={(event) => onBackgroundChange({ kind: "color", color: event.target.value })} aria-label="Background color" />
          ) : null}
          {sceneOffered ? (
            flipbook.backgrounds.scene ? (
              <ToggleChip size="xs" selected={background.kind === "scene"} disabled={!backgroundAllowed(format, "scene")} onClick={() => onBackgroundChange({ kind: "scene" })}>Your scene</ToggleChip>
            ) : (
              <Button size="xs" variant="outline" disabled={creatingScene || !backgroundAllowed(format, "scene")} onClick={onCreateScene} title="Muse Image redraws your illustration without the character, once (1 drawing).">
                {creatingScene ? <Spinner className="size-3" /> : <HugeiconsIcon icon={Image01Icon} size={12} strokeWidth={1.75} />}Use your scene
              </Button>
            )
          ) : null}
          {flipbook.backgrounds.custom ? (
            <ToggleChip size="xs" selected={background.kind === "custom"} disabled={!backgroundAllowed(format, "custom")} onClick={() => onBackgroundChange({ kind: "custom" })}>Your image</ToggleChip>
          ) : null}
          <Button size="xs" variant="ghost" disabled={!backgroundAllowed(format, "custom")} onClick={() => fileRef.current?.click()}>{flipbook.backgrounds.custom ? "Replace image" : "Upload image"}</Button>
          <input
            ref={fileRef} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onUploadBackground(file);
            }}
          />
        </div>
      </div>
      {format === "mp4" ? <p className={styles.hint}>MP4 · H.264 · 24 fps. Each drawing is held for {holdFrames(settings.drawingFps)} frames ({settings.drawingFps} drawings per second). MP4 has no transparency.</p> : null}
      {!allowed ? <p className={styles.hint} data-invalid="">This background isn’t available for {FORMAT_LABEL[format]}.</p> : null}
      {!exportable.ok ? <p className={styles.hint} data-invalid="">{exportable.reason}</p> : null}

      <Button onClick={onExport} disabled={!exportable.ok || !allowed || exporting} aria-busy={exporting || undefined}>
        {exporting ? <Spinner className="size-4" /> : <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.75} />}
        {exporting ? "Rendering and verifying…" : `Export ${FORMAT_LABEL[format]}`}
      </Button>

      {latest.length ? (
        <div className={styles.exportsList}>
          <p className={styles.sectionLabel}>Exports</p>
          <ul>
            {latest.map((record) => (
              <li key={record.key}>
                <span className="text-xs text-foreground">{FORMAT_LABEL[record.format]}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {record.facts.width}×{record.facts.height} · {record.facts.frames} {record.format === "mp4" ? "frames" : "drawings"}
                  {record.facts.durationSeconds !== null ? ` · ${record.facts.durationSeconds.toFixed(2)} s` : ""}
                </span>
                <span className={styles.exportFiles}>
                  {record.files.map((file) => (
                    <a key={file.name} href={`${file.url}&download=1`} download={file.name} className="text-xs text-primary hover:underline">
                      {file.name.endsWith(".json") ? "Atlas JSON" : "Download"} ({formatBytes(file.bytes)})
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
