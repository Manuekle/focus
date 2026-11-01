"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowExpand01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, PanelRightOpenIcon, ZoomInIcon, ZoomOutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { MediaImage } from "../../components/ui/media-image";
import { MediaLightbox, ZoomButton, type LightboxMedia } from "../../components/ui/media-lightbox";
import { Spinner } from "../../components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import {
  rotoscopeUrls,
  TRACE_STEP_LABEL,
  TRACE_STEPS,
  type AttemptTrace,
  type FrameTrace,
  type RotoscopeMedia,
  type RotoscopeRun,
  type TraceImage,
  type TraceStep,
  type TraceStepId,
} from "../../shared/rotoscope";
import { STATE_LABEL, frameState } from "./frame-state";
import { rotoscopeApi } from "./rotoscope-client";
import styles from "./pipeline-canvas.module.css";

// The Pipeline view: how one frame's drawing is made, as a flow on the canvas. Each attempt is a
// lane of nodes (inputs and guardrails → Muse Spark's prompt → Muse Image → cut-out and measures →
// the Python fidelity gate → Muse Spark's review → the decision); a rejected attempt loops into
// the next lane with what it was told to fix. Read from the attempt traces the server writes as
// each step starts and ends (server/rotoscope/trace.ts), polled while the frame is being drawn.

const NODE_W = 248;
const NODE_H = 236;
const GAP_X = 56;
const LANE_GAP = 112;
const PAD = 56;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.6;
const FIT_FLOOR = 0.62;
/** Room the frame strip and chips above, and the drawing controls below, take from a fit or a follow. */
const FIT_TOP = 72;
const FIT_BOTTOM = 64;
const FOLLOW_MARGIN = 24;
/** The step panel's width plus its gap, kept clear when a picked node is brought into view. */
const PANEL_ROOM = 424;
const POLL_MS = 1500;

/** What each step does, shown before a frame has any trace. */
const PLANNED: Record<TraceStepId, string> = {
  inputs: "Video frame, character sheet, pose guide and the previous approved frame; checks there is a body to follow.",
  prompt: "Muse Spark writes Muse Image's prompt from the template; guardrails add back any clause it dropped.",
  generate: "Muse Image edits the video frame into the character, with every reference labelled.",
  measure: "Background keyed out, colours held to the palette, DWPose finds the drawn pose, drawing registered on the grid.",
  fidelity: "fidelity.py (OpenCV, NumPy) and SAM 3.1: pose, limb angles, missing or extra limbs, proportions, motion and continuity.",
  review: "Muse Spark compares every limb with the video, the identity with the sheet, the build and the clean-up.",
  decision: "Approved only when every check passes and fidelity reaches the bar; otherwise the next attempt is told what to fix.",
};

const METRIC_LABEL: Record<string, string> = {
  pose: "Pose", limbs: "Limb angles", integrity: "Limb integrity", proportions: "Proportions", motion: "Motion", continuity: "Continuity", identity: "Identity", silhouette: "Silhouette",
};
const KEY_METRICS = ["pose", "limbs", "integrity", "continuity"] as const;

type XY = { readonly x: number; readonly y: number };
type Picked = { readonly attempt: number | null; readonly step: TraceStepId };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const nodeX = (column: number) => PAD + column * (NODE_W + GAP_X);
const laneY = (lane: number) => PAD + lane * (NODE_H + LANE_GAP);

type Outcome = "approved" | "rejected" | "review" | "running" | "stopped";
const OUTCOME_LABEL: Record<Outcome, string> = { approved: "Approved", rejected: "Rejected", review: "Approved with warnings", running: "Running", stopped: "Stopped" };

/** Where an attempt stands: its decision once made, else running (still being drawn) or stopped. */
function outcomeOf(lane: AttemptTrace, live: boolean): Outcome {
  const decision = lane.steps.find((step) => step.id === "decision");
  if (decision && decision.status !== "running") return decision.status === "done" ? "approved" : decision.status === "warn" ? "review" : "rejected";
  return live ? "running" : "stopped";
}

function imageUrl(run: RotoscopeRun, image: TraceImage): string {
  if (image.kind === "work" && image.name && image.frame) return rotoscopeUrls.work(run.id, image.frame, image.attempt, image.name);
  if (image.kind === "guide" && image.frame) return rotoscopeUrls.guide(run, image.frame);
  return rotoscopeUrls.media(run.id, image.kind as RotoscopeMedia, image.frame, image.attempt);
}

const time = (ms: number | null) => (ms === null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export function PipelineCanvas({ run, frame, onFrame, dockOpen, onToggleDock, actions }: {
  readonly run: RotoscopeRun;
  readonly frame: number;
  readonly onFrame: (index: number) => void;
  readonly dockOpen: boolean;
  readonly onToggleDock: () => void;
  /** The editor's drawing controls (draw, stop, redraw), floated at the bottom centre as on the frame sheet. */
  readonly actions?: ReactNode;
}) {
  const [trace, setTrace] = useState<FrameTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  /** A step's pictures opened large over the canvas; null keeps the lightbox closed. */
  const [preview, setPreview] = useState<{ readonly items: readonly LightboxMedia[]; readonly index: number } | null>(null);
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  // Moves the view makes on its own (fit, follow, reveal) ease; a person's drag and wheel are immediate.
  const [glide, setGlide] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  /** Measures `--dock-covered`: how much of the canvas a floating inspector hides on the right. */
  const coverRef = useRef<HTMLSpanElement>(null);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const fitted = useRef<string>("");
  /** Set once the person pans or zooms: the view stops fitting and following on its own until they fit again. */
  const touched = useRef(false);
  const view = useRef({ zoom, pan });
  useLayoutEffect(() => {
    view.current = { zoom, pan };
  }, [zoom, pan]);

  const live = run.live?.frame === frame ? run.live : null;
  const drawing = live !== null;
  const entry = run.frames.find((candidate) => candidate.index === frame) ?? null;
  // Refetched whenever the frame's state moves: a new attempt, a new live stage, an approval.
  const version = `${frame}:${entry?.attempts.length ?? 0}:${entry?.status ?? ""}:${live ? `${live.attempt}:${live.stage}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    const load = () => rotoscopeApi.trace(run.id, frame).then((value) => {
      if (cancelled) return;
      setTrace(value);
      setError(null);
    }, (reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "We couldn’t read this frame’s pipeline.");
    });
    void load();
    // While this frame is being drawn its trace grows step by step.
    const timer = drawing ? setInterval(load, POLL_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [run.id, frame, version, drawing]);

  useEffect(() => setPicked(null), [frame]);

  const lanes = useMemo<readonly (AttemptTrace | null)[]>(() => (trace?.attempts.length ? trace.attempts : [null]), [trace]);
  const width = nodeX(TRACE_STEPS.length) - GAP_X + PAD;
  const height = laneY(lanes.length) - LANE_GAP + PAD;

  /** The part of the canvas a person can see: the viewport less a floating inspector. */
  const visible = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    return { w: Math.max(0, viewport.clientWidth - (coverRef.current?.offsetWidth ?? 0)), h: viewport.clientHeight };
  }, []);

  const fit = useCallback((smooth = true) => {
    const area = visible();
    if (!area) return;
    const room = area.h - FIT_TOP - FIT_BOTTOM;
    // Seven nodes don't fit a laptop's canvas at a size that reads: past FIT_FLOOR the lane pans sideways instead.
    const next = clamp(Math.min(area.w / width, room / height), FIT_FLOOR, 1);
    touched.current = false;
    setGlide(smooth);
    setZoom(next);
    setPan({
      x: width * next <= area.w ? (area.w - width * next) / 2 : 0,
      // Taller than the room: the first lane's heading sits just under the frame strip.
      y: height * next <= room ? FIT_TOP + (room - height * next) / 2 : FIT_TOP - (laneY(0) - 40) * next,
    });
  }, [width, height, visible]);

  /** Brings one node into the visible part of the canvas, centred, if any of it is out of sight. */
  const reveal = useCallback((lane: number, column: number, rightInset = 0) => {
    const area = visible();
    if (!area) return;
    const { zoom: z, pan: p } = view.current;
    const right = Math.max(NODE_W * z, area.w - rightInset);
    const bottom = area.h - FIT_BOTTOM;
    const [x1, x2] = [p.x + nodeX(column) * z, p.x + (nodeX(column) + NODE_W) * z];
    const [y1, y2] = [p.y + (laneY(lane) - 40) * z, p.y + (laneY(lane) + NODE_H) * z];
    const x = x1 < FOLLOW_MARGIN || x2 > right - FOLLOW_MARGIN ? right / 2 - (nodeX(column) + NODE_W / 2) * z : p.x;
    const y = y1 < FIT_TOP || y2 > bottom ? FIT_TOP + (bottom - FIT_TOP) / 2 - (laneY(lane) + NODE_H / 2 - 20) * z : p.y;
    if (x === p.x && y === p.y) return;
    setGlide(true);
    setPan({ x, y });
  }, [visible]);

  // A new frame opens fitted; a new attempt refits unless the person has moved the view themselves.
  useLayoutEffect(() => {
    const [lastFrame] = fitted.current.split(":");
    const key = `${frame}:${lanes.length}`;
    if (fitted.current === key) return;
    const newFrame = lastFrame !== String(frame);
    fitted.current = key;
    if (newFrame || !touched.current) fit(!newFrame);
  }, [frame, lanes.length, fit]);

  // The canvas resizes with the window and when the inspector opens over it: refit while the view is the app's own.
  const fitLatest = useRef(fit);
  useLayoutEffect(() => {
    fitLatest.current = fit;
  }, [fit]);
  useEffect(() => {
    const viewport = viewportRef.current;
    const cover = coverRef.current;
    if (!viewport || !cover || typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(() => {
      // The observer reports once on attach; the layout effect has already fitted for that.
      if (first) {
        first = false;
        return;
      }
      if (!touched.current) fitLatest.current(true);
    });
    observer.observe(viewport);
    observer.observe(cover);
    return () => observer.disconnect();
  }, []);

  // While the frame is being drawn the view follows the step that is running, until the person takes over.
  useEffect(() => {
    if (!drawing || touched.current || !trace?.attempts.length) return;
    const lane = trace.attempts.length - 1;
    const step = trace.attempts[lane].steps.findLast((candidate) => candidate.status === "running") ?? trace.attempts[lane].steps.at(-1);
    if (step) reveal(lane, TRACE_STEPS.indexOf(step.id));
  }, [trace, drawing, reveal]);

  // The frame strip keeps the current frame in sight (scrolled within itself, never the page).
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-index="${frame}"]`);
    if (!strip || !chip) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
  }, [frame]);

  // Wheel pans, ⌘/ctrl + wheel zooms into the pointer (non-passive: the page mustn't scroll or zoom).
  useEffect(() => {
    const view = viewportRef.current;
    if (!view) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      setGlide(false);
      if (event.ctrlKey || event.metaKey) {
        const rect = view.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        setZoom((current) => {
          const next = clamp(current * Math.exp(-event.deltaY * 0.0022), MIN_ZOOM, MAX_ZOOM);
          setPan((p) => ({ x: point.x - ((point.x - p.x) / current) * next, y: point.y - ((point.y - p.y) / current) * next }));
          return next;
        });
      } else {
        setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
      }
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const area = visible();
    if (!area) return;
    const centre = { x: area.w / 2, y: area.h / 2 };
    const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    touched.current = true;
    setGlide(true);
    setPan((p) => ({ x: centre.x - ((centre.x - p.x) / zoom) * next, y: centre.y - ((centre.y - p.y) / zoom) * next }));
    setZoom(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,a,[data-panel]")) return;
    panRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    touched.current = true;
    setGlide(false);
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    if (!start) return;
    setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y });
  };
  const onPointerUp = () => {
    panRef.current = null;
    setPanning(false);
  };

  const pickedStep = useMemo(() => {
    if (!picked) return null;
    const lane = lanes.find((candidate) => (candidate?.attempt ?? null) === picked.attempt) ?? null;
    return { lane, step: lane?.steps.find((step) => step.id === picked.step) ?? null };
  }, [picked, lanes]);

  const bar = lanes.find((lane) => lane?.bar != null)?.bar ?? null;
  const pick = (lane: number, attempt: number | null, id: TraceStepId) => {
    setPicked({ attempt, step: id });
    // The step panel opens over the right of the canvas: keep the node it describes in sight beside it.
    reveal(lane, TRACE_STEPS.indexOf(id), PANEL_ROOM);
  };
  const failedPreflight = trace?.preflight.find((guardrail) => !guardrail.passed) ?? null;

  /** Opens one of a step's pictures large, with the rest of that step's pictures a key away. */
  const zoomImages = (lane: AttemptTrace | null, id: TraceStepId, images: readonly TraceImage[], index: number) => {
    if (!images.length) return;
    const where = `${TRACE_STEP_LABEL[id]} · frame ${frame}${lane ? ` · attempt ${lane.attempt}` : ""}`;
    setPreview({
      items: images.map((image) => ({
        kind: "image" as const,
        src: imageUrl(run, image),
        alt: image.label,
        caption: `${where} · ${image.label}`,
        // The cut-out and the registered drawing are keyed: they read on the checkerboard, as on the frame sheet.
        transparent: image.kind === "attempt" || (image.kind === "work" && image.name === "keyed"),
      })),
      index,
    });
  };

  return (
    <div className={styles.canvas}>
      <span ref={coverRef} className={styles.coverProbe} aria-hidden />
      <div
        ref={viewportRef}
        className={cn(styles.viewport, panning && styles.grabbing)}
        role="group"
        aria-label={`Pipeline of frame ${frame}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "Escape") setPicked(null);
          if (event.key === "ArrowRight" && frame < run.total) onFrame(frame + 1);
          if (event.key === "ArrowLeft" && frame > 1) onFrame(frame - 1);
          if (event.key === "0" || event.key.toLowerCase() === "f") fit();
        }}
      >
        <div
          className={cn(styles.dots, glide && styles.glide)}
          style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${22 * zoom}px ${22 * zoom}px` }}
          aria-hidden
        />
        <div
          className={cn(styles.world, glide && styles.glide)}
          style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          onTransitionEnd={() => setGlide(false)}
        >
          <svg className={styles.edges} width={width} height={height} aria-hidden>
            {lanes.map((lane, i) => (
              <g key={lane?.attempt ?? "planned"}>
                {TRACE_STEPS.slice(1).map((id, column) => {
                  const to = lane?.steps.find((step) => step.id === id);
                  const y = laneY(i) + NODE_H / 2;
                  const [x1, x2] = [nodeX(column) + NODE_W, nodeX(column + 1)];
                  return (
                    <path
                      key={id}
                      d={`M ${x1} ${y} C ${x1 + GAP_X / 2} ${y}, ${x2 - GAP_X / 2} ${y}, ${x2} ${y}`}
                      className={styles.edge}
                      data-state={!to ? "pending" : to.status === "running" ? "active" : to.status === "skipped" ? "skipped" : "done"}
                    />
                  );
                })}
                {i < lanes.length - 1 ? (() => {
                  // A rejected attempt loops back into the next one with what it must fix.
                  const [fromX, fromY] = [nodeX(TRACE_STEPS.length - 1) + NODE_W / 2, laneY(i) + NODE_H];
                  const [toX, toY] = [nodeX(0) + NODE_W / 2, laneY(i + 1) - 44];
                  const mid = fromY + (LANE_GAP - 44) / 2;
                  return (
                    <>
                      <path d={`M ${fromX} ${fromY} L ${fromX} ${mid - 16} Q ${fromX} ${mid} ${fromX - 16} ${mid} L ${toX + 16} ${mid} Q ${toX} ${mid} ${toX} ${mid + 16} L ${toX} ${toY}`} className={styles.retry} />
                      <text x={(fromX + toX) / 2} y={mid - 8} className={styles.retryLabel} textAnchor="middle">retry with the corrections</text>
                    </>
                  );
                })() : null}
              </g>
            ))}
          </svg>
          {lanes.map((lane, i) => {
            const liveLane = lane !== null && drawing && i === lanes.length - 1;
            return (
              <div key={lane?.attempt ?? "planned"} className={styles.lane}>
                <LaneHead run={run} frame={frame} lane={lane} live={liveLane} drawnBefore={(entry?.attempts.length ?? 0) > 0} at={{ x: nodeX(0), y: laneY(i) - 40 }} />
                {TRACE_STEPS.map((id, column) => {
                  const step = lane?.steps.find((candidate) => candidate.id === id) ?? null;
                  return (
                    <PipelineNode
                      key={id}
                      run={run}
                      id={id}
                      step={step}
                      bar={lane?.bar ?? null}
                      at={{ x: nodeX(column), y: laneY(i) }}
                      // What comes next in the attempt being drawn reads as queued, not as an idle plan.
                      queued={liveLane && step === null}
                      selected={picked?.step === id && picked.attempt === (lane?.attempt ?? null)}
                      onPick={() => pick(i, lane?.attempt ?? null, id)}
                      onZoom={(images, index) => zoomImages(lane, id, images, index)}
                      onFocusKey={() => reveal(i, column, picked ? PANEL_ROOM : 0)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.header}>
        <div className={styles.frameNav} role="group" aria-label="Frames">
          <Button size="icon-sm" variant="ghost" aria-label="Previous frame" disabled={frame <= 1} onClick={() => onFrame(frame - 1)}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
          </Button>
          <div ref={stripRef} className={styles.strip}>
            {run.frames.map((candidate) => {
              const state = frameState(run, candidate);
              return (
                <button
                  key={candidate.index}
                  type="button"
                  data-index={candidate.index}
                  data-state={state}
                  aria-current={candidate.index === frame ? "true" : undefined}
                  className={styles.frameChip}
                  title={`Frame ${candidate.index} · ${STATE_LABEL[state]}`}
                  aria-label={`Frame ${candidate.index}, ${STATE_LABEL[state]}`}
                  onClick={() => onFrame(candidate.index)}
                >
                  {candidate.index}
                </button>
              );
            })}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Next frame" disabled={frame >= run.total} onClick={() => onFrame(frame + 1)}>
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
          </Button>
          {live ? <span className={styles.liveChip} role="status"><Spinner className="size-3" />{live.stage}</span> : null}
        </div>
        <div className={styles.preflight} aria-label="Environment guardrails">
          {trace?.preflight.map((guardrail) => (
            <span key={guardrail.name} className={styles.chip} data-ok={guardrail.passed} title={guardrail.detail}>
              {guardrail.passed ? "✓" : "✗"} {guardrail.name === "python" ? "Python tools" : guardrail.name === "meta-api" ? "Meta API" : "Muse models"}
            </span>
          ))}
          {bar !== null ? <span className={styles.chip} data-ok title="A drawing is approved only at this fidelity, with no floor broken">bar {bar} %</span> : null}
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {failedPreflight ? <p className={styles.error} role="alert">{failedPreflight.detail}</p> : null}
      </div>

      <p className={styles.hint} aria-hidden>Drag to pan · ⌘ scroll to zoom · click a step to open it</p>

      {actions ? <div className={styles.actionBar} role="group" aria-label="Drawing">{actions}</div> : null}

      <div className={styles.toolbar} role="toolbar" aria-label="Pipeline view">
        <Tool icon={ZoomOutIcon} label="Zoom out" onClick={() => zoomBy(1 / 1.2)} />
        <span className={styles.zoom}>{Math.round(zoom * 100)}%</span>
        <Tool icon={ZoomInIcon} label="Zoom in" onClick={() => zoomBy(1.2)} />
        <span className={styles.divider} aria-hidden />
        <Tool icon={ArrowExpand01Icon} label="Fit the pipeline" onClick={() => fit()} />
        {/* The inspector closes from its own header; the toolbar only offers to bring it back. */}
        {dockOpen ? null : (
          <>
            <span className={styles.divider} aria-hidden />
            <Tool icon={PanelRightOpenIcon} label="Show inspector" onClick={onToggleDock} />
          </>
        )}
      </div>

      {picked && pickedStep ? (
        <StepPanel key={`${picked.attempt}-${picked.step}`} run={run} id={picked.step} step={pickedStep.step} lane={pickedStep.lane} onZoom={(images, index) => zoomImages(pickedStep.lane, picked.step, images, index)} onClose={() => setPicked(null)} />
      ) : null}

      <MediaLightbox
        items={preview?.items ?? []}
        index={preview?.index ?? null}
        onIndexChange={(index) => setPreview((current) => (current ? { ...current, index } : current))}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

function Tool({ icon, label, onClick }: { readonly icon: typeof ZoomInIcon; readonly label: string; readonly onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} className={styles.tool}>
          <HugeiconsIcon icon={icon} size={15} strokeWidth={1.75} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/** An attempt's heading: which try it is, how far along it is and how it ended. */
function LaneHead({ run, frame, lane, live, drawnBefore, at }: {
  readonly run: RotoscopeRun;
  readonly frame: number;
  readonly lane: AttemptTrace | null;
  readonly live: boolean;
  readonly drawnBefore: boolean;
  readonly at: XY;
}) {
  if (!lane) {
    return (
      <div className={styles.laneHead} style={{ left: at.x, top: at.y }}>
        <strong>How frame {frame} will be drawn</strong>
        <span>{drawnBefore ? "its attempts were drawn before the pipeline was recorded" : "not drawn yet"}</span>
      </div>
    );
  }
  const outcome = outcomeOf(lane, live);
  const finished = lane.steps.filter((step) => step.status !== "running").length;
  const running = lane.steps.findLast((step) => step.status === "running");
  const total = lane.steps.reduce((sum, step) => sum + (step.ms ?? 0), 0);
  return (
    <div className={styles.laneHead} style={{ left: at.x, top: at.y }}>
      <strong>Attempt {lane.attempt}</strong>
      <span className={styles.outcome} data-outcome={outcome}>
        {outcome === "running" ? <Spinner className="size-3" /> : null}
        {outcome === "running" && running ? TRACE_STEP_LABEL[running.id] : OUTCOME_LABEL[outcome]}
      </span>
      <span className={styles.progress} aria-label={`${finished} of ${TRACE_STEPS.length} steps`}>
        <span style={{ width: `${(finished / TRACE_STEPS.length) * 100}%` }} data-outcome={outcome} />
      </span>
      <span>try {lane.tries} of {run.maxAttempts}</span>
      <span>{new Date(lane.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      {total > 0 ? <span>{time(total)}</span> : null}
    </div>
  );
}

function PipelineNode({ run, id, step, bar, at, queued, selected, onPick, onZoom, onFocusKey }: {
  readonly run: RotoscopeRun;
  readonly id: TraceStepId;
  readonly step: TraceStep | null;
  readonly bar: number | null;
  readonly at: XY;
  readonly queued: boolean;
  readonly selected: boolean;
  readonly onPick: () => void;
  /** A thumbnail opens large: the step's pictures, starting at the one clicked. */
  readonly onZoom: (images: readonly TraceImage[], index: number) => void;
  /** Tabbed to from the keyboard: the canvas pans the node into sight (it never scrolls on focus). */
  readonly onFocusKey: () => void;
}) {
  const status = step?.status ?? (queued ? "queued" : "pending");
  const failedGuardrails = step?.guardrails.filter((guardrail) => !guardrail.passed).length ?? 0;
  const metrics = step && Object.keys(step.metrics).length ? KEY_METRICS.filter((name) => step.metrics[name] != null) : [];
  return (
    // The card is a box, not a button: its thumbnails are buttons of their own, and a button cannot hold one.
    <div
      className={styles.node}
      data-status={status}
      data-selected={selected}
      style={{ left: at.x, top: at.y, width: NODE_W, height: NODE_H }}
    >
      {/* The whole card opens the step, low enough for a thumbnail to be picked above it. */}
      <button
        type="button"
        className={styles.nodeHit}
        onClick={onPick}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) onFocusKey();
        }}
        aria-label={`${TRACE_STEP_LABEL[id]}: ${status}`}
      />
      {/* Keyed by status, so a step that starts or ends eases its new content in instead of swapping on the spot. */}
      <span key={status} className={styles.nodeBody}>
        <span className={styles.nodeHead}>
          <span className={styles.dot} data-status={status} aria-hidden />
          <span className={styles.nodeTitle}>{TRACE_STEP_LABEL[id]}</span>
          {step?.ms != null ? <span className={styles.ms}>{time(step.ms)}</span> : status === "running" ? <Spinner className="size-3" /> : null}
        </span>
        {step?.model ? <span className={styles.model}>{step.model}</span> : null}
        <span className={styles.summary}>{step ? step.summary || (status === "running" ? "working…" : "") : PLANNED[id]}</span>
        {metrics.length ? (
          <span className={styles.metrics}>
            {metrics.map((name) => <Meter key={name} label={METRIC_LABEL[name]} value={step!.metrics[name]!} bar={bar} compact />)}
          </span>
        ) : step?.images.length ? (
          <span className={styles.thumbs}>
            {step.images.slice(0, 3).map((image, index) => (
              <ZoomButton
                key={`${image.kind}-${image.name ?? ""}-${image.label}`}
                label={`Enlarge ${image.label}`}
                onOpen={() => onZoom(step.images, index)}
                className={styles.thumb}
                title={image.label}
              >
                <MediaImage src={imageUrl(run, image)} alt={image.label} loading="lazy" />
              </ZoomButton>
            ))}
          </span>
        ) : null}
        <span className={styles.nodeFoot}>
          {step?.guardrails.length ? (
            <span className={styles.chip} data-ok={failedGuardrails === 0}>{step.guardrails.length - failedGuardrails}/{step.guardrails.length} guardrails</span>
          ) : null}
          {step?.checks.length ? (
            <span className={styles.chip} data-ok={step.checks.every((check) => check.passed)}>{step.checks.filter((check) => check.passed).length}/{step.checks.length} checks</span>
          ) : null}
          {step?.score != null ? <span className={styles.score} data-ok={bar === null || step.score >= bar}>{step.score.toFixed(1)} %</span> : null}
        </span>
      </span>
    </div>
  );
}

function Meter({ label, value, bar, compact }: { readonly label: string; readonly value: number; readonly bar: number | null; readonly compact?: boolean }) {
  const ok = bar === null || value >= bar;
  return (
    <span className={cn(styles.meter, compact && styles.meterCompact)}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} data-ok={bar === null ? "info" : ok} style={{ width: `${clamp(value, 0, 100)}%` }} />
        {bar !== null ? <span className={styles.meterBar} style={{ left: `${bar}%` }} aria-hidden /> : null}
      </span>
      <span className={styles.meterValue}>{value.toFixed(0)}</span>
    </span>
  );
}

function StepPanel({ run, id, step, lane, onZoom, onClose }: { readonly run: RotoscopeRun; readonly id: TraceStepId; readonly step: TraceStep | null; readonly lane: AttemptTrace | null; readonly onZoom: (images: readonly TraceImage[], index: number) => void; readonly onClose: () => void }) {
  return (
    <aside className={styles.panel} data-panel aria-label={TRACE_STEP_LABEL[id]}>
      <div className={styles.panelHead}>
        <div className="min-w-0">
          <p className={styles.panelEyebrow}>{lane ? `Frame ${lane.frame} · attempt ${lane.attempt}` : "Planned step"}</p>
          <h3 className={styles.panelTitle}>{TRACE_STEP_LABEL[id]}</h3>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} /></Button>
      </div>
      <div className={styles.panelBody}>
        {!step ? <p className={styles.panelText}>{PLANNED[id]}</p> : (
          <>
            <p className={styles.panelMeta}>
              <span className={styles.dot} data-status={step.status} aria-hidden />{step.status}
              {step.model ? <> · {step.model}</> : null}
              {step.ms != null ? <> · {time(step.ms)}</> : null}
            </p>
            {step.summary ? <p className={styles.panelText}>{step.summary}</p> : null}
            {step.images.length ? (
              <div className={styles.panelImages}>
                {step.images.map((image, index) => (
                  <div key={`${image.kind}-${image.name ?? ""}-${image.label}`} className={styles.panelImage}>
                    <ZoomButton label={`Enlarge ${image.label}`} onOpen={() => onZoom(step.images, index)} className={styles.panelPicture}>
                      <MediaImage src={imageUrl(run, image)} alt={image.label} />
                    </ZoomButton>
                    <span>{image.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {Object.keys(step.metrics).length ? (
              <section>
                <h4 className={styles.panelSection}>Measures{lane?.bar != null ? ` · bar ${lane.bar} %` : ""}</h4>
                <div className={styles.panelMetrics}>
                  {Object.entries(step.metrics).filter(([name, value]) => value !== null && METRIC_LABEL[name]).map(([name, value]) => (
                    <Meter key={name} label={METRIC_LABEL[name]} value={value!} bar={name === "silhouette" ? null : lane?.bar ?? null} />
                  ))}
                </div>
              </section>
            ) : null}
            {step.guardrails.length ? (
              <section>
                <h4 className={styles.panelSection}>Guardrails</h4>
                <ul className={styles.list}>
                  {step.guardrails.map((guardrail) => (
                    <li key={guardrail.name} data-ok={guardrail.passed}><span aria-hidden>{guardrail.passed ? "✓" : "✗"}</span><span><b>{guardrail.name}</b> {guardrail.detail}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}
            {step.checks.length ? (
              <section>
                <h4 className={styles.panelSection}>Checks</h4>
                <ul className={styles.list}>
                  {step.checks.map((check) => (
                    <li key={check.name} data-ok={check.passed && check.status !== "warn"} data-warn={check.status === "warn" || check.status === "inconclusive"}>
                      <span aria-hidden>{check.passed ? (check.status === "warn" ? "!" : "✓") : check.status === "inconclusive" ? "?" : "✗"}</span><span><b>{check.name}</b> {check.detail}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {step.detail ? (
              <section>
                <h4 className={styles.panelSection}>{id === "prompt" ? "Exact prompt sent" : "Details"}</h4>
                <pre className={styles.pre}>{step.detail}</pre>
              </section>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
