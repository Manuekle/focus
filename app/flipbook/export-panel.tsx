"use client";

import { useState } from "react";
import { Download01Icon, Video01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { MediaLightbox, type LightboxMedia } from "../../components/ui/media-lightbox";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { formatBytes } from "../../shared/media";
import {
  DURATIONS,
  EXPOSURE_FPS,
  backgroundMoves,
  exposureSheet,
  playbackCycle,
  type ExportFormat,
  type FlipbookAspect,
  type Flipbook,
  type FlipbookBackground,
  type PlaybackSettings,
} from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const FORMAT_LABEL: Record<ExportFormat, string> = { mp4: "MP4", gif: "GIF", spritesheet: "Sprite sheet", frames: "PNG frames" };

const ASPECTS: readonly { readonly value: FlipbookAspect; readonly label: string; readonly hint: string }[] = [
  { value: "16:9", label: "16:9", hint: "Landscape" },
  { value: "9:16", label: "9:16", hint: "Portrait" },
];

const BACKGROUND_LABEL: Record<FlipbookBackground["kind"], string> = { transparent: "Transparent", color: "Color", scene: "Scene", custom: "Image", generated: "Generated" };


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
  exportable,
  exporting,
  onExport,
  sending,
  onSendToEditor,
}: {
  readonly flipbook: Flipbook;
  readonly settings: PlaybackSettings;
  readonly onSettingsChange: (settings: PlaybackSettings) => void;
  readonly format: ExportFormat;
  readonly onFormatChange: (format: ExportFormat) => void;
  readonly background: FlipbookBackground;
  readonly exportable: { ok: true } | { ok: false; reason: string };
  readonly exporting: boolean;
  readonly onExport: () => void;
  readonly sending: boolean;
  readonly onSendToEditor: () => void;
}) {
  const scene = flipbook.cast.length > 0 || Boolean(flipbook.sequence);
  const { drawings, holds } = exposureSheet(playbackCycle(flipbook, settings.inbetweens !== false), settings.drawingFps, settings.cycleSeconds);
  const actualFps = Math.round((drawings.length * EXPOSURE_FPS) / holds.reduce((sum, hold) => sum + hold, 0));
  const [shortest, longest] = [Math.min(...holds), Math.max(...holds)];
  const timed = format === "mp4" || (format === "gif" && (settings.motion !== "in_place" || backgroundMoves(background)));
  const allowed = backgroundAllowed(format, background.kind);
  const latest = flipbook.exports.slice(0, 6);
  const [preview, setPreview] = useState<LightboxMedia | null>(null);
  // What can be looked at in the page: a clip or a picture. A zip of frames cannot.
  const previewOf = (record: (typeof latest)[number], file: (typeof latest)[number]["files"][number]): LightboxMedia | null => {
    const caption = `${FORMAT_LABEL[record.format]} · ${record.facts.width}×${record.facts.height}`;
    if (file.type.startsWith("video/")) return { kind: "video", src: file.url, alt: `${FORMAT_LABEL[record.format]} export`, caption };
    if (file.type.startsWith("image/")) return { kind: "image", src: file.url, alt: `${FORMAT_LABEL[record.format]} export`, caption, transparent: record.background.kind === "transparent" };
    return null;
  };

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

      <div className={styles.controlRow}>
        <span className={styles.controlLabel}>Aspect</span>
        <div className={styles.chips} role="group" aria-label="Aspect ratio">
          {ASPECTS.map(({ value, label, hint }) => (
            <ToggleChip key={value} size="xs" selected={settings.aspect === value} onClick={() => onSettingsChange({ ...settings, aspect: value })} title={hint}>{label}</ToggleChip>
          ))}
        </div>
      </div>
      {format === "spritesheet" || format === "frames" ? <p className={styles.hint}>Sprite sheets and PNG frames keep the drawing size; the aspect applies to MP4, GIF and the preview.</p> : null}

      {scene ? (
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Length</span>
          <span className="text-xs text-foreground tabular-nums">{flipbook.plan?.durationSeconds ?? settings.durationSeconds} s · {flipbook.frames.length} drawings</span>
        </div>
      ) : (
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Length</span>
          <div className={styles.chips}>
            {DURATIONS.map((value) => (
              <ToggleChip key={value} size="xs" selected={settings.durationSeconds === value} onClick={() => onSettingsChange({ ...settings, durationSeconds: value })}>{value} s</ToggleChip>
            ))}
          </div>
        </div>
      )}
      {!timed ? <p className={styles.hint}>{scene ? "The complete action, with every drawing and its original timing." : format === "gif" ? "The GIF is one cycle that loops forever." : "One cycle, with frame order and timing."}</p> : null}

      {format === "mp4" ? <p className={styles.hint}>MP4 · H.264 · 60 fps. {Math.abs(shortest - longest) < 1e-6 ? <>Each drawing is held for {Math.round((shortest * 1000) / EXPOSURE_FPS)} ms ({actualFps} drawings per second).</> : <>{actualFps} drawings per second on average, with pose timing.</>} {(settings.smoothing ?? 0) > 0 ? "Light smoothing softens pose changes. " : ""}MP4 has no transparency.</p> : null}
      {!allowed ? <p className={styles.hint} data-invalid="">{BACKGROUND_LABEL[background.kind]} backgrounds aren’t available for {FORMAT_LABEL[format]}. Pick another background or format.</p> : null}
      {!exportable.ok ? <p className={styles.hint} data-invalid="">{exportable.reason}</p> : null}

      <Button onClick={onExport} disabled={!exportable.ok || !allowed || exporting} aria-busy={exporting || undefined}>
        {exporting ? <Spinner className="size-4" /> : <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.75} />}
        {exporting ? "Rendering and verifying…" : `Export ${FORMAT_LABEL[format]}`}
      </Button>

      <div className={styles.handoff}>
        <Button variant="outline" onClick={onSendToEditor} disabled={!exportable.ok || sending} aria-busy={sending || undefined}>
          {sending ? <Spinner className="size-4" /> : <HugeiconsIcon icon={Video01Icon} size={16} strokeWidth={1.75} />}
          {sending ? "Preparing the clip…" : "Animate in the video editor"}
        </Button>
        <p className={styles.hint}>
          Opens this animation as a {settings.durationSeconds} s clip in the editor, where you can track it and add effects.
          {background.kind === "transparent" ? " The editor needs a background, so it goes on white." : ""}
        </p>
      </div>

      {latest.length ? (
        <div className={styles.exportsList}>
          <p className={styles.sectionLabel}>Exports</p>
          <ul>
            {latest.map((record) => (
              <li key={record.key}>
                <span className="text-xs text-foreground">{FORMAT_LABEL[record.format]}</span>
                {record.facts.fps ? <span className="text-[11px] text-muted-foreground">{record.facts.fps} fps</span> : null}
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {record.facts.width}×{record.facts.height} · {record.facts.frames} {record.format === "mp4" ? "frames" : "drawings"}
                  {record.facts.durationSeconds !== null ? ` · ${record.facts.durationSeconds.toFixed(2)} s` : ""}
                </span>
                <span className={styles.exportFiles}>
                  {record.files.map((file) => {
                    const media = previewOf(record, file);
                    return media ? (
                      <button key={`${file.name}-view`} type="button" className={styles.exportView} onClick={() => setPreview(media)}>
                        <HugeiconsIcon icon={ViewIcon} size={12} strokeWidth={1.9} />View
                      </button>
                    ) : null;
                  })}
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
      <MediaLightbox items={preview ? [preview] : []} index={preview ? 0 : null} onClose={() => setPreview(null)} />
    </section>
  );
}
