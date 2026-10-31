"use client";

import { MediaImage } from "../../components/ui/media-image";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Cancel01Icon, Refresh01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useToast } from "../../components/toast-provider";
import { MAPPING_BONES, MAPPING_JOINTS, rotoscopeUrls, type MappingJoint, type MappingView, type RotoscopeRun } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import { rotoscopeApi } from "./rotoscope-client";
import { ReviewImages } from "./review-images";
import styles from "./rotoscope.module.css";

// The overlay inspector for one attempt's character mapping: the drawing
// with the target skeleton (where the source pose puts each joint), the
// skeleton measured on the drawing, the rig it was deformed from, the
// repainted regions and the body regions, with every number the engine
// stored. Target joints can be dragged: the correction applies to the
// frame's next drawing.

type Layer = "target" | "drawn" | "rig" | "repaint" | "regions";
const LAYERS: readonly { id: Layer; label: string }[] = [
  { id: "target", label: "Target" },
  { id: "drawn", label: "Measured" },
  { id: "rig", label: "Rig base" },
  { id: "repaint", label: "Repainted" },
  { id: "regions", label: "Regions" },
];
const METHOD: Record<NonNullable<MappingView["diagnostics"]>["method"], string> = {
  "rig-deform": "Character rig",
  "rig-deform+muse-repair": "Character rig + Muse Image repair",
  "muse-image": "Muse Image",
  higgsfield: "Higgsfield",
};

type Point = readonly [number, number];
const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)} %`);
/** Joint error in torso lengths: under 5 % is on target, under 10 % close. */
const errorTone = (value: number | undefined) => (value === undefined ? "var(--muted-foreground)" : value < 0.05 ? "var(--status-success-fg)" : value < 0.1 ? "var(--status-warning-fg, #d69a00)" : "var(--status-failed-fg)");

function Skeleton({ joints, stroke, dashed, width = 5 }: { readonly joints: Partial<Record<string, readonly number[]>>; readonly stroke: string; readonly dashed?: boolean; readonly width?: number }) {
  return (
    <g stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeDasharray={dashed ? "14 10" : undefined} fill="none">
      {MAPPING_BONES.map(([a, b]) => {
        const [p, q] = [joints[a], joints[b]];
        return p && q ? <line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} /> : null;
      })}
    </g>
  );
}

export function MappingInspector({ run, frame, attempt, canCorrect, busy, onRedraw }: {
  readonly run: RotoscopeRun;
  readonly frame: number;
  readonly attempt: number;
  readonly canCorrect: boolean;
  readonly busy: boolean;
  readonly onRedraw: () => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<MappingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(new Set<Layer>(["target", "drawn"]));
  const [moved, setMoved] = useState<Partial<Record<MappingJoint, Point>>>({});
  const [dragging, setDragging] = useState<MappingJoint | null>(null);
  const [saving, setSaving] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const [measuring, setMeasuring] = useState(false);
  const measure = async () => {
    setMeasuring(true);
    try {
      await rotoscopeApi.diagnoseMapping(run.id, frame, attempt);
      // Read back what was written: the measuring call can outlast the view it started from.
      const next = await rotoscopeApi.mapping(run.id, frame, attempt);
      setView(next);
      setMoved(next.overrides as Partial<Record<MappingJoint, Point>>);
    } catch (cause) {
      toast({ title: "Couldn’t measure the mapping", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setMeasuring(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    setView(null);
    setError(null);
    rotoscopeApi.mapping(run.id, frame, attempt).then((next) => {
      if (stopped) return;
      setView(next);
      setMoved(next.overrides as Partial<Record<MappingJoint, Point>>);
    }, (cause: unknown) => { if (!stopped) setError(cause instanceof Error ? cause.message : "The mapping couldn’t be loaded."); });
    return () => { stopped = true; };
  }, [run.id, frame, attempt]);

  if (error) return <p className={fb.hint}>{error}</p>;
  if (!view) return <div className={`${fb.inspect} ${styles.inspectFrame}`}><Spinner className="size-4" /></div>;
  const diagnostics = view.diagnostics;
  if (!diagnostics) {
    return (
      <div className="flex flex-col gap-2">
        <p className={fb.hint}>No mapping was recorded for attempt {attempt}: it was drawn before the character mapping engine. Measuring it runs the pose estimator on this server; no AI call.</p>
        {canCorrect ? (
          <Button size="sm" variant="outline" className="w-fit" disabled={busy || measuring} onClick={() => void measure()}>
            {measuring ? <Spinner className="size-3.5" /> : null}Measure frame {frame}’s attempts
          </Button>
        ) : null}
        <ReviewImages run={run} frame={frame} attempt={attempt} review={view.review} />
      </div>
    );
  }

  const target = { ...diagnostics.target.joints } as Record<string, readonly number[]>;
  for (const [name, p] of Object.entries(moved)) target[name] = [p[0], p[1], 1];
  const toggle = (layer: Layer) => setLayers((current) => {
    const next = new Set(current);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    return next;
  });
  const toCanvas = (event: ReactPointerEvent): Point | null => {
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!element || !matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [Math.round(p.x), Math.round(p.y)];
  };
  const changed = JSON.stringify(moved) !== JSON.stringify(view.overrides);
  const save = async (joints: Partial<Record<MappingJoint, Point>>) => {
    setSaving(true);
    try {
      const next = await rotoscopeApi.correctMapping(run.id, frame, joints);
      setView((current) => (current ? { ...current, overrides: next.overrides } : current));
      setMoved(next.overrides as Partial<Record<MappingJoint, Point>>);
      toast({ title: Object.keys(joints).length ? "Correction saved" : "Correction cleared", description: Object.keys(joints).length ? `Frame ${frame}’s next drawing deforms to the joints you moved.` : undefined, status: "success" });
    } catch (cause) {
      toast({ title: "Couldn’t save the correction", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setSaving(false);
    }
  };
  const worstBone = Object.entries(diagnostics.boneError).sort((a, b) => b[1] - a[1])[0];
  const media = (kind: "exposed" | "labels") => `${rotoscopeUrls.media(run.id, kind, frame, attempt)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className={fb.chips} role="group" aria-label="Overlay layers">
        {LAYERS.filter((layer) => (layer.id === "rig" ? diagnostics.rig : layer.id === "repaint" ? diagnostics.masks.exposed : layer.id === "regions" ? diagnostics.masks.labels : true)).map((layer) => (
          <ToggleChip key={layer.id} size="xs" selected={layers.has(layer.id)} onClick={() => toggle(layer.id)}>{layer.label}</ToggleChip>
        ))}
      </div>
      <div className={`${fb.inspect} ${styles.inspectFrame}`} data-transparent="">
        <div className={styles.mapBox}>
          <MediaImage src={rotoscopeUrls.media(run.id, "attempt", frame, attempt)} alt={`Attempt ${attempt}`} draggable={false} />
          {/* eslint-disable-next-line @next/next/no-img-element -- the body regions of the drawing it was deformed from */}
          {layers.has("regions") && diagnostics.masks.labels ? <img className={styles.mapLayer} style={{ opacity: 0.55 }} src={media("labels")} alt="" draggable={false} /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- the repainted regions, tinted */}
          {layers.has("repaint") && diagnostics.masks.exposed ? <img className={`${styles.mapLayer} ${styles.mapRepaint}`} src={media("exposed")} alt="" draggable={false} /> : null}
          <svg
            ref={svg}
            className={styles.mapSvg}
            viewBox={`0 0 ${view.canvas.width} ${view.canvas.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Target and measured skeletons"
            onPointerMove={(event) => {
              if (!dragging) return;
              const p = toCanvas(event);
              if (p) setMoved((current) => ({ ...current, [dragging]: p }));
            }}
            onPointerUp={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
          >
            {layers.has("rig") && diagnostics.rig ? <Skeleton joints={diagnostics.rig.joints} stroke="rgba(120,120,120,0.85)" width={4} /> : null}
            {layers.has("drawn") && diagnostics.generated ? <Skeleton joints={diagnostics.generated.joints} stroke="rgba(214,51,132,0.9)" /> : null}
            {layers.has("target") ? (
              <>
                <Skeleton joints={target} stroke="rgba(0,166,81,0.95)" dashed />
                {MAPPING_JOINTS.map((name) => {
                  const p = target[name];
                  if (!p) return null;
                  return (
                    <circle
                      key={name}
                      cx={p[0]}
                      cy={p[1]}
                      r={moved[name] ? 13 : 10}
                      fill={errorTone(diagnostics.jointError[name])}
                      stroke="#ffffff"
                      strokeWidth={3}
                      className={canCorrect ? styles.mapJoint : undefined}
                      onPointerDown={canCorrect ? (event) => { event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId); setDragging(name); } : undefined}
                    >
                      <title>{`${name}: ${diagnostics.jointError[name] !== undefined ? `${Math.round(diagnostics.jointError[name] * 100)} % of the torso off` : "not measured"}${canCorrect ? " — drag to correct" : ""}`}</title>
                    </circle>
                  );
                })}
              </>
            ) : null}
          </svg>
        </div>
      </div>
      {canCorrect ? (
        <div className={fb.buttonRow}>
          <Button size="sm" variant="outline" disabled={!changed || saving || busy} onClick={() => void save(moved)}>
            <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={1.75} />Save correction
          </Button>
          {Object.keys(view.overrides).length ? (
            <Button size="sm" variant="ghost" disabled={saving || busy} onClick={() => void save({})}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />Clear
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy || changed} onClick={onRedraw} title="Draw this frame again, with the saved correction">
            <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />Redraw frame {frame}
          </Button>
        </div>
      ) : null}
      {canCorrect ? <p className={fb.hint}>Green dashed: where the video’s pose puts each joint on your character. Pink: the pose measured on this drawing. Drag a green joint to correct the target.</p> : null}

      <ReviewImages run={run} frame={frame} attempt={attempt} review={view.review} />

      <div className={fb.checks}>
        <span className={fb.sectionLabel}>Mapping · attempt {attempt}</span>
        <ul className={styles.checkRows}>
          <Metric name="Method" detail={`${METHOD[diagnostics.method]}${diagnostics.base ? ` · ${diagnostics.base.mode} from ${diagnostics.base.id}${diagnostics.base.distance !== null ? ` (${Math.round(diagnostics.base.distance)}° away)` : ""}, chain ${diagnostics.base.depth + 1}` : ""}`} />
          <Metric name="Joint error" detail={`mean ${percent(diagnostics.meanJointError)} of the torso${worstBone ? `; worst bone ${worstBone[0]} ${worstBone[1]}°` : ""}`} passed={diagnostics.meanJointError === null ? undefined : diagnostics.meanJointError < 0.1} />
          <Metric name="Silhouette" detail={diagnostics.silhouette === null ? "no rig prediction for this drawing" : `${percent(diagnostics.silhouette)} overlap with the rig’s prediction`} />
          <Metric name="Character consistency" detail={diagnostics.consistency === null ? "—" : `${percent(diagnostics.consistency)} colour overlap with the character sheet`} />
          <Metric name="Masks" detail={`character: ${diagnostics.masks.segmentation}${diagnostics.masks.subjectTracked ? "; source subject tracked by SAM 3.1" : ""}; ${diagnostics.exposedArea} px exposed${diagnostics.repair ? ` · ${diagnostics.repair.note}` : ""}`} />
          {diagnostics.missing.length || diagnostics.occluded.length || diagnostics.target.unseen.length ? (
            <Metric name="Missing or occluded" detail={[...diagnostics.missing.map((name) => `${name} not found in the drawing`), ...diagnostics.target.unseen.map((name) => `${name} hidden in the video`), ...diagnostics.source.bridged.map((name) => `${name} bridged`)].join(", ") || "—"} passed={diagnostics.missing.length ? false : undefined} />
          ) : null}
          {diagnostics.source.swapped ? <Metric name="Left and right" detail="the pose estimator swapped the sides in this video frame; they were put back" /> : null}
        </ul>
      </div>

      {diagnostics.policies.length ? (
        <div className={fb.checks}>
          <span className={fb.sectionLabel}>Animation policies</span>
          <ul className={styles.checkRows}>
            {diagnostics.policies.map((outcome) => (
              <li key={`${outcome.stage}-${outcome.id}`} data-passed={outcome.passed ? "true" : outcome.kind === "advisory" ? "skipped" : "false"}>
                <span className={styles.checkIcon} aria-hidden><HugeiconsIcon icon={outcome.passed ? Tick02Icon : Cancel01Icon} size={11} strokeWidth={2.2} /></span>
                <span className="min-w-0">
                  <span className={styles.checkName}>{outcome.id} <Badge tone="neutral">{outcome.kind}</Badge></span>
                  <span className={styles.checkDetail}>{outcome.detail} · {outcome.skill} — “{outcome.section}”</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ name, detail, passed }: { readonly name: string; readonly detail: string; readonly passed?: boolean }) {
  return (
    <li data-passed={passed === undefined ? "skipped" : String(passed)}>
      <span className={styles.checkIcon} aria-hidden>{passed === undefined ? "·" : <HugeiconsIcon icon={passed ? Tick02Icon : Cancel01Icon} size={11} strokeWidth={2.2} />}</span>
      <span className="min-w-0">
        <span className={styles.checkName}>{name}</span>
        <span className={styles.checkDetail}>{detail}</span>
      </span>
    </li>
  );
}
