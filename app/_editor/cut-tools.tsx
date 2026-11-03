"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRightIcon, Delete02Icon, Redo02Icon, ScissorIcon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { isWhole, keptSeconds, playableTime, removeSegment, segmentAt, splitAt, trimEdge, type CutSegment } from "../../shared/cut";
import { ApiErrorBodySchema, VideoAssetSchema, type VideoAsset } from "../../shared/schemas";
import { timecode } from "../flipbook/frame-timeline";
import type { TimelineCut } from "./media-timeline";
import { useCut } from "./use-cut";

/** Keys that belong to whatever has focus: typing, sliders, menus. */
const OWNS_KEYS = 'input, textarea, select, [contenteditable="true"], [role="slider"], [role="menuitem"], [role="option"], [role="tab"], [role="textbox"]';

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

async function requestCut(videoId: string, keep: readonly CutSegment[]): Promise<VideoAsset> {
  const response = await fetch(`/api/videos/${videoId}/cut`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep }) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ApiErrorBodySchema.safeParse(body);
    throw new Error(error.success ? error.data.error.message : "We couldn’t cut this clip. Try again.");
  }
  return VideoAssetSchema.parse(body);
}

/**
 * Cutting the clip before an edit: split at the playhead, drop parts, trim
 * their edges on the timeline, undo and redo. The preview plays only the
 * kept parts. `applyCut` makes the cut real (a new clip on the server) and
 * hands it to `onCut`.
 */
export function useCutEditor({ video, media, enabled, onCut }: {
  readonly video: VideoAsset;
  readonly media: HTMLVideoElement | null;
  readonly enabled: boolean;
  /** The new clip, and whether the edit should start on it right away. */
  readonly onCut: (clip: VideoAsset, generate: boolean) => void;
}) {
  const { durationSeconds: duration, fps } = video.normalized;
  const cut = useCut(duration);
  const { segments, apply, preview, commit, undo, redo } = cut;
  const [selected, setSelected] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const whole = isWhole(segments, duration);
  const selectedIndex = selected !== null && selected < segments.length ? selected : null;

  // Playback skips what will be removed: a gap jumps to the next kept part.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  useEffect(() => {
    if (!enabled || !media || whole) return;
    let frame = 0;
    const skip = () => {
      const at = playableTime(segmentsRef.current, media.currentTime);
      if (Math.abs(at - media.currentTime) > 1e-3) media.currentTime = at;
    };
    const loop = () => { skip(); frame = requestAnimationFrame(loop); };
    const onPlay = () => { cancelAnimationFrame(frame); loop(); };
    const onPause = () => cancelAnimationFrame(frame);
    if (!media.paused) loop();
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
    };
  }, [enabled, media, whole]);

  const now = useCallback(() => media?.currentTime ?? 0, [media]);
  const split = useCallback(() => {
    const at = now();
    apply((current) => splitAt(current, at));
    setSelected(null);
  }, [apply, now]);
  const remove = useCallback(() => {
    const index = selectedIndex ?? segmentAt(segments, now());
    if (index < 0) return;
    apply((current) => removeSegment(current, index));
    setSelected(null);
  }, [apply, now, segments, selectedIndex]);
  /** I and O: the part under the playhead starts or ends here. */
  const mark = useCallback((edge: "start" | "end") => {
    const at = now();
    const index = segmentAt(segments, at);
    if (index < 0) return;
    apply((current) => trimEdge(current, index, edge, at, duration));
  }, [apply, duration, now, segments]);
  const step = useCallback((frames: number) => {
    if (!media) return;
    media.pause();
    media.currentTime = Math.max(0, Math.min(duration - 0.001, (Math.round(media.currentTime * fps) + frames) / fps));
  }, [duration, fps, media]);

  const applyCut = useCallback(async (generate: boolean) => {
    setApplying(true);
    setFailure(null);
    try {
      onCut(await requestCut(video.id, segments), generate);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "We couldn’t cut this clip. Try again.");
      setApplying(false);
    }
  }, [onCut, segments, video.id]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || applying) return;
      if (event.target instanceof Element && event.target.closest(OWNS_KEYS)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const mod = event.metaKey || event.ctrlKey;
      let action: (() => void) | null = null;
      if (mod && !event.altKey) {
        if (key === "z") action = event.shiftKey ? redo : undo;
        else if (key === "y") action = redo;
      } else if (!event.altKey && !mod) {
        if (key === "s") action = split;
        else if (key === "Delete" || key === "Backspace") action = remove;
        else if (key === "i") action = () => mark("start");
        else if (key === "o") action = () => mark("end");
        else if (key === "," || (key === "ArrowLeft" && event.shiftKey)) action = () => step(-1);
        else if (key === "." || (key === "ArrowRight" && event.shiftKey)) action = () => step(1);
        else if (key === "Escape" && selectedIndex !== null) action = () => setSelected(null);
      }
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, enabled, mark, redo, remove, selectedIndex, split, step, undo]);

  const timeline: TimelineCut | undefined = enabled ? {
    segments,
    selected: selectedIndex,
    fps,
    onSelect: setSelected,
    onTrim: (index, edge, time) => preview((current) => trimEdge(current, index, edge, time, duration)),
    onTrimEnd: commit,
  } : undefined;

  return { ...cut, whole, kept: keptSeconds(segments), selected: selectedIndex, split, remove, applyCut, applying, failure, timeline };
}

function Tool({ label, keys, onClick, disabled, children }: { readonly label: string; readonly keys: string; readonly onClick: () => void; readonly disabled?: boolean; readonly children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={label} aria-keyshortcuts={keys.replace("⌘", "Meta+")} onClick={onClick} disabled={disabled}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label} <span className="ml-1 opacity-60">{keys}</span></TooltipContent>
    </Tooltip>
  );
}

/** The cut controls in the timeline's toolbar. */
export function CutTools({ editor, duration, originalId, onOriginal }: {
  readonly editor: ReturnType<typeof useCutEditor>;
  readonly duration: number;
  /** Set on a clip that was cut from another: offers to go back to it. */
  readonly originalId?: string;
  readonly onOriginal: (videoId: string) => void;
}) {
  const busy = editor.applying;
  return (
    <>
      <Tool label="Split at playhead" keys="S" onClick={editor.split} disabled={busy}><HugeiconsIcon icon={ScissorIcon} size={14} strokeWidth={1.75} /></Tool>
      <Tool label={editor.selected !== null ? "Remove selected part" : "Remove part at playhead"} keys="⌫" onClick={editor.remove} disabled={busy || editor.segments.length <= 1}><HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.75} /></Tool>
      <Tool label="Undo" keys={`${MOD}Z`} onClick={editor.undo} disabled={busy || !editor.canUndo}><HugeiconsIcon icon={Undo02Icon} size={14} strokeWidth={1.75} /></Tool>
      <Tool label="Redo" keys={`${MOD}⇧Z`} onClick={editor.redo} disabled={busy || !editor.canRedo}><HugeiconsIcon icon={Redo02Icon} size={14} strokeWidth={1.75} /></Tool>
      {editor.whole ? (
        originalId ? (
          <Button size="xs" variant="ghost" onClick={() => onOriginal(originalId)}>
            <HugeiconsIcon icon={ArrowLeftRightIcon} size={13} strokeWidth={1.75} />Uncut clip
          </Button>
        ) : null
      ) : (
        <>
          <span className="px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">{timecode(editor.kept)} of {timecode(duration)}</span>
          <Button size="xs" variant="secondary" onClick={() => void editor.applyCut(false)} disabled={busy} aria-busy={busy}>{busy ? "Cutting…" : "Apply cut"}</Button>
        </>
      )}
    </>
  );
}
