"use client";

import { useEffect, useState } from "react";
import { Download01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { MediaLightbox } from "../../components/ui/media-lightbox";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useToast } from "../../components/toast-provider";
import { formatBytes } from "../../shared/media";
import { COMPARE_BACKGROUNDS, COMPARE_FORMATS, COMPARE_SIZES, CompareOptionsSchema, rotoscopeUrls, type CompareOptions, type CompareResult, type RotoscopeRun } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import { rotoscopeApi } from "./rotoscope-client";
import styles from "./rotoscope.module.css";

const OPTIONS_KEY = "focus.rotoscope.compare";
const FORMAT_LABEL: Record<CompareOptions["format"], string> = { mp4: "MP4", mov: "MOV", webm: "WebM", gif: "GIF" };
const FORMAT_HINT: Record<CompareOptions["format"], string> = {
  mp4: "H.264: plays everywhere and opens in any video editor.",
  mov: "H.264 in a QuickTime file, the one Final Cut, Premiere and DaVinci take most readily.",
  webm: "VP9, for web pages.",
  gif: "Silent and looping, but large: keep it Small.",
};
const BACKGROUND_LABEL: Record<CompareOptions["background"], string> = { white: "White", dark: "Dark" };
const SIZE_LABEL: Record<CompareOptions["size"], string> = { small: "Small", medium: "Medium", large: "Large" };

/**
 * Downloads the Preview as one clip: the video and the approved drawings together, side by side or one above
 * the other, in the format a video editor or a web page takes. Rendered on the server from the same frames the
 * Preview plays (the unbroken run of approved ones from the first).
 */
export function CompareExport({ run, frames }: { readonly run: RotoscopeRun; /** How many drawings the clip would have. */ readonly frames: number }) {
  const { toast } = useToast();
  const [options, setOptions] = useState<CompareOptions>(() => CompareOptionsSchema.parse({}));
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    try {
      const saved = CompareOptionsSchema.safeParse(JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null"));
      if (saved.success) setOptions(saved.data);
    } catch { /* storage unavailable or unreadable: the defaults stand */ }
  }, []);
  const choose = (change: Partial<CompareOptions>) => {
    const next = { ...options, ...change };
    setOptions(next);
    try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  };

  const silent = options.format === "gif";
  const canSound = run.hasAudio && !silent;
  const sound = options.sound && canSound;
  const second = options.first === "video" ? "drawing" : "video";
  const where = options.layout === "side" ? ["left", "right"] : ["on top", "below"];
  const unavailable = frames === 0 ? "Approve a drawing first: the clip is made of the approved ones." : null;

  const render = async () => {
    setExporting(true);
    try {
      setResult(await rotoscopeApi.exportCompare(run.id, { ...options, sound }));
    } catch (cause) {
      toast({ title: "Couldn’t render the comparison", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={styles.compareExport} aria-labelledby="ro-compare-export">
      <h2 id="ro-compare-export" className={fb.panelTitle}>Comparison video</h2>
      <p className={fb.hint}>Download the video and the drawings together, to place side by side or one above the other.</p>

      <div className={fb.controlRow} role="group" aria-label="Layout">
        <span className={fb.controlLabel}>Layout</span>
        <ToggleChip size="xs" selected={options.layout === "side"} onClick={() => choose({ layout: "side" })}>Side by side</ToggleChip>
        <ToggleChip size="xs" selected={options.layout === "stack"} onClick={() => choose({ layout: "stack" })}>Top and bottom</ToggleChip>
      </div>
      <div className={fb.controlRow} role="group" aria-label="Order">
        <span className={fb.controlLabel}>{options.layout === "side" ? "Left" : "Top"}</span>
        <ToggleChip size="xs" selected={options.first === "video"} onClick={() => choose({ first: "video" })}>Video</ToggleChip>
        <ToggleChip size="xs" selected={options.first === "drawing"} onClick={() => choose({ first: "drawing" })}>Drawing</ToggleChip>
      </div>
      <div className={styles.layoutSketch} data-layout={options.layout} aria-hidden>
        <span data-kind={options.first}>{options.first === "video" ? "Video" : "Drawing"}</span>
        <span data-kind={second}>{second === "video" ? "Video" : "Drawing"}</span>
      </div>
      <p className={fb.hint}>{options.first === "video" ? "Video" : "Drawing"} {where[0]}, {second} {where[1]}.</p>

      <div className={fb.controlRow} role="group" aria-label="Drawing background">
        <span className={fb.controlLabel} title="A clip has no transparency: the drawings sit on this.">Drawing on</span>
        {COMPARE_BACKGROUNDS.map((value) => <ToggleChip key={value} size="xs" selected={options.background === value} onClick={() => choose({ background: value })}>{BACKGROUND_LABEL[value]}</ToggleChip>)}
      </div>
      <div className={fb.controlRow} role="group" aria-label="Format">
        <span className={fb.controlLabel}>Format</span>
        {COMPARE_FORMATS.map((value) => <ToggleChip key={value} size="xs" selected={options.format === value} onClick={() => choose({ format: value })}>{FORMAT_LABEL[value]}</ToggleChip>)}
      </div>
      <p className={fb.hint}>{FORMAT_HINT[options.format]}</p>
      <div className={fb.controlRow} role="group" aria-label="Size">
        <span className={fb.controlLabel} title="The clip’s longest side, in pixels.">Size</span>
        {(Object.keys(COMPARE_SIZES) as CompareOptions["size"][]).map((value) => <ToggleChip key={value} size="xs" selected={options.size === value} onClick={() => choose({ size: value })}>{SIZE_LABEL[value]} · {COMPARE_SIZES[value]}</ToggleChip>)}
      </div>
      {options.layout === "stack" ? <p className={fb.hint}>Two upright pictures stacked make a tall clip, so Size is its height: Large keeps both sharp.</p> : null}
      <div className={fb.controlRow}>
        <span className={fb.controlLabel} title="Adds the reference video’s sound, in step with the drawings.">Sound</span>
        <Switch checked={sound} disabled={!canSound} onCheckedChange={(on) => choose({ sound: on })} label="Sound: add the reference video’s audio to the clip" />
        {!run.hasAudio ? <span className={fb.controlValue}>No sound in this video</span> : silent ? <span className={fb.controlValue}>GIFs have no sound</span> : null}
      </div>

      {unavailable ? <p className={fb.hint} data-invalid="">{unavailable}</p> : null}
      <Button onClick={() => void render()} disabled={frames === 0 || exporting} aria-busy={exporting || undefined}>
        {exporting ? <Spinner className="size-4" /> : <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.75} />}
        {exporting ? "Rendering…" : `Render ${FORMAT_LABEL[options.format]}`}
      </Button>

      {result ? (
        <div className={styles.compareResult} role="status">
          <span className="text-xs text-foreground">{FORMAT_LABEL[result.format]} · {result.width}×{result.height}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{result.frames} drawings · {result.seconds.toFixed(2)} s · {result.fps} fps · {result.sound ? "with sound · " : ""}{formatBytes(result.bytes)}</span>
          <span className={styles.compareActions}>
            <button type="button" className={fb.exportView} onClick={() => setViewing(true)}>
              <HugeiconsIcon icon={ViewIcon} size={12} strokeWidth={1.9} />View
            </button>
            <a href={rotoscopeUrls.compare(run.id, result.file, result.name)} download={result.name} className="text-xs text-primary hover:underline">Download</a>
          </span>
        </div>
      ) : null}
      <MediaLightbox
        items={result ? [{ kind: result.format === "gif" ? "image" : "video", src: rotoscopeUrls.compare(run.id, result.file), alt: "Comparison video", caption: `${FORMAT_LABEL[result.format]} · ${result.width}×${result.height}` }] : []}
        index={result && viewing ? 0 : null}
        onClose={() => setViewing(false)}
      />
    </section>
  );
}
