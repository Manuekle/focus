"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AiPaintbrushIcon, ArrowRight01Icon, Cancel01Icon, Download02Icon, LayoutThreeColumnIcon, PanelRightCloseIcon, Refresh01Icon, PencilEdit02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert, useDismissedNotices, type AlertTone } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useToast } from "../../components/toast-provider";
import { nextOpenFrame, rotoscopeUrls, type RotoscopeFrame, type RotoscopeLive, type RotoscopeRun } from "../../shared/rotoscope";
import { MAX_SEQUENCE_FRAMES, SEQUENCE_CLOCK } from "../../shared/sequence";
import composer from "../_editor/composer.module.css";
import fb from "../flipbook/flipbook.module.css";
import { frameState, STATE_LABEL, time } from "./frame-state";
import { rotoscopeApi } from "./rotoscope-client";
import { CHECKS } from "./rotoscope-create";
import { PencilNote } from "./pencil-note";
import { MediaLightbox, ZoomButton, type LightboxMedia } from "../../components/ui/media-lightbox";
import { CompareSheet } from "./compare-sheet";
import { RotoscopeCanvas } from "./rotoscope-canvas";
import { RotoscopePlayer, type LiveStage } from "./rotoscope-player";
import styles from "./rotoscope.module.css";

const LIVE_STEPS = [
  { stage: "drawing", label: "Drawing" },
  { stage: "measuring", label: "Cutting out & measuring" },
  { stage: "checking", label: "Pose, size, proportions" },
  { stage: "reviewing", label: "Visual review" },
] as const;
const LIVE_LABEL: Record<RotoscopeLive["stage"], string> = {
  drawing: "Drawing the frame…",
  measuring: "Cutting out and measuring the pose…",
  checking: "Checking pose, size, proportions and background…",
  reviewing: "Muse Spark is comparing it with the video…",
  approved: "Approved",
  rejected: "Rejected — trying again",
};
const PREPARE_STEPS = [
  { key: "extracted", label: "Frames" },
  { key: "DWPose", label: "Poses" },
  { key: "describing", label: "Character" },
] as const;
const CHECK_LABEL: Record<string, string> = Object.fromEntries(CHECKS.map((check) => [check.name, check.label]));
/** Flipbook's longest sequence, in whole seconds. */
const MAX_SEQUENCE_SECONDS = MAX_SEQUENCE_FRAMES / SEQUENCE_CLOCK;

/**
 * A run as a free canvas: the frame sheet fills the workspace and can be
 * panned and zoomed, the light table sits in a drawer over it, and the
 * inspector docks on the right. While the run draws, the inspector follows the
 * frame in progress and the canvas opens on it.
 */
export function RotoscopeEditor({ run, onChange }: { readonly run: RotoscopeRun; readonly onChange: (run: RotoscopeRun) => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const live = run.live;
  const next = nextOpenFrame(run);
  const working = run.phase === "preparing" || run.phase === "generating" || run.phase === "stopping";
  const complete = run.total > 0 && run.approved === run.total;
  const started = run.frames.some((frame) => frame.attempts.length > 0);
  const halted = run.halted && run.phase === "ready" ? run.halted : null;
  // While drawing, the inspector follows the frame in progress until another frame is picked.
  const selectedIndex = picked ?? live?.frame ?? halted?.frame ?? next ?? 1;
  const selected = run.frames.find((frame) => frame.index === selectedIndex) ?? run.frames[0] ?? null;
  useEffect(() => { if (live && picked === live.frame) setPicked(null); }, [live, picked]);
  // An attempt picked in the canvas tray: the inspector opens on it.
  // The three pictures of one frame side by side, over the canvas.
  const [comparing, setComparing] = useState(false);
  // The attempt the inspector is showing, so the canvas tray can mark it.
  const [viewing, setViewing] = useState<{ readonly frame: number; readonly attempt: number | null } | null>(null);
  const [attemptPick, setAttemptPick] = useState<{ readonly frame: number; readonly attempt: number } | null>(null);
  // On a narrow screen the inspector would cover the whole canvas, so it starts closed there.
  const [dockOpen, setDockOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 861px)").matches);
  const [dockTab, setDockTab] = useState<"frame" | "preview" | "run">("frame");
  // Picking a frame leaves the Run tab for its inspector; the Preview tab follows the pick instead.
  const pick = (index: number) => { setPicked(index); setDockTab((tab) => (tab === "run" ? "frame" : tab)); };

  const playable = useMemo(() => {
    const approved = run.frames.filter((frame) => frame.status === "approved");
    // Only the unbroken run of approved frames from the first plays as an animation.
    return approved.filter((frame, position) => frame.index === position + 1).map((frame) => ({
      index: frame.index,
      drawing: `${rotoscopeUrls.media(run.id, "frame", frame.index)}&v=${frame.approvedAttempt}`,
      source: rotoscopeUrls.media(run.id, "source", frame.index),
    }));
  }, [run.id, run.frames]);
  const liveStage: LiveStage | null = live && !picked ? {
    index: live.frame,
    source: rotoscopeUrls.media(run.id, "source", live.frame),
    drawing: live.image ? rotoscopeUrls.media(run.id, "attempt", live.frame, live.attempt) : null,
    label: `Frame ${live.frame} · attempt ${live.tries}/${run.maxAttempts} · ${LIVE_LABEL[live.stage]}`,
  } : null;

  const act = async (label: string, action: () => Promise<RotoscopeRun>) => {
    setActing(true);
    try { onChange(await action()); }
    catch (cause) { toast({ title: label, description: cause instanceof Error ? cause.message : "Try again.", status: "error" }); }
    finally { setActing(false); }
  };
  // Two drawings per attempt (Muse Image + Higgsfield), the closer match kept; the server remembers it per run.
  const [dual, setDual] = useState(run.dual);
  const draw = () => void act("Couldn’t start drawing", () => rotoscopeApi.generate(run.id, { dual }));
  const correct = (frame: number, attempt: number, note: { comment: string; marks: Blob; redraw: boolean }) => void act("Couldn’t save your note", async () => {
    const updated = await rotoscopeApi.correct(run.id, { frame, attempt, comment: note.comment, marks: note.marks });
    if (!note.redraw) return updated;
    onChange(updated);
    return rotoscopeApi.generate(run.id, { dual });
  });
  const attempts = run.frames.reduce((sum, frame) => sum + frame.attempts.length, 0);
  const segment = `${run.start.toFixed(1)}–${run.seconds !== null ? (run.start + run.seconds).toFixed(1) : "end"} s`;
  // The unbroken approved prefix (what Flipbook can take) at whole seconds.
  const firstOpen = run.frames.findIndex((frame) => frame.status !== "approved");
  const prefix = firstOpen === -1 ? run.frames.length : firstOpen;
  const wholeSeconds = Math.min(MAX_SEQUENCE_SECONDS, Math.floor(prefix / run.fps));
  const canOpen = run.approved > 0 && wholeSeconds >= 1 && !working;

  const openInFlipbook = async () => {
    setOpening(true);
    try {
      const { flipbookId } = await rotoscopeApi.openInFlipbook(run.id);
      router.push(`/flipbook?f=${flipbookId}`);
    } catch (cause) {
      toast({ title: "Couldn’t open in Flipbook", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setOpening(false);
    }
  };

  // One notice at a time, most urgent first. Informational ones can be closed, and the next one in line takes their place.
  const { isDismissed, dismiss } = useDismissedNotices(run.id);
  const hints: { readonly key: string; readonly tone: AlertTone; readonly text: ReactNode }[] = [];
  if (complete && !working) hints.push({ key: "complete", tone: "success", text: "Every frame approved. Open it in Flipbook, play it in the preview, or download the transparent PNGs." });
  if (run.approved > 0 && wholeSeconds < 1 && !working) hints.push({ key: "whole-seconds", tone: "info", text: `Flipbook works in whole seconds: approve at least ${Math.ceil(run.fps)} frames in order to open this run there.` });
  if (run.approved > 0 && prefix / run.fps > MAX_SEQUENCE_SECONDS && !working) hints.push({ key: "max-seconds", tone: "info", text: `Flipbook holds up to ${MAX_SEQUENCE_SECONDS} s: only the first ${MAX_SEQUENCE_SECONDS} s of approved frames will open there.` });
  const hint = hints.find((entry) => !isDismissed(entry.key));
  const notice = run.error ? (
    <Alert tone="error" role="alert" size="sm">{run.error}</Alert>
  ) : halted ? (
    <Alert tone="warning" size="sm" title={`Stopped at frame ${halted.frame}`} action={
      <div className={fb.buttonRow}>
        <Button size="sm" variant="ai" disabled={acting} onClick={draw}>Resume from frame {halted.frame}</Button>
        {selectedIndex !== halted.frame ? <Button size="sm" variant="ghost" onClick={() => setPicked(halted.frame)}>Review frame {halted.frame}</Button> : null}
      </div>
    }>
      Every attempt at this frame failed a check, so nothing after it was drawn. Resume to try it again (approved frames are kept), or approve one of its attempts in the inspector if it looks right to you.
    </Alert>
  ) : hint ? (
    <Alert key={hint.key} tone={hint.tone} size="sm" onDismiss={() => dismiss(hint.key)}>{hint.text}</Alert>
  ) : null;

  // The canvas's own controls, bottom centre: draw what is left, or redraw the frame that is selected.
  const redrawable = selected !== null && run.phase === "ready" && selected.index !== next && (selected.status === "approved" || selected.attempts.length > 0);
  const drawing = run.phase === "generating" || run.phase === "stopping";
  const canvasActions = !run.frames.length ? null : drawing ? (
    <>
      <span className={styles.barStatus} role="status">
        <Spinner className="size-3.5" />
        {run.phase === "stopping" ? "Stopping after this drawing" : live ? `Drawing frame ${live.frame} of ${run.total}` : "Drawing…"}
      </span>
      <Button size="sm" variant="outline" disabled={acting || run.phase === "stopping"} onClick={() => void act("Couldn’t stop", () => rotoscopeApi.stop(run.id))}>
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />Stop
      </Button>
    </>
  ) : run.phase === "ready" && ((!complete && run.total > 0) || redrawable) ? (
    <>
      {!complete && run.total > 0 ? (
        <Button size="sm" variant="ai" disabled={acting} onClick={draw} title={started ? `Keeps frames 1–${(next ?? 1) - 1} and draws the rest.` : "Draws one image per frame, in order."}>
          {acting ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />}
          {started ? `Resume from frame ${next}` : `Draw ${run.total} frames`}
        </Button>
      ) : null}
      {redrawable && selected ? (
        <Button
          size="sm"
          variant="outline"
          disabled={acting}
          onClick={() => void act("Couldn’t redraw", () => rotoscopeApi.generate(run.id, { frame: selected.index }))}
          title={`Draws frame ${selected.index} again, up to ${run.maxAttempts} attempts. Its current drawing stays unless a new one passes every check.`}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />Redraw frame {selected.index}
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <div className={fb.editor}>
      <div className={fb.editorHead}>
        <div className="min-w-0">
          <p className={fb.sectionLabel}>Rotoscope · {run.fps} fps · {segment}</p>
          <h1 className={fb.editorTitle} title={run.name}>{run.name}</h1>
        </div>
        <div className={fb.headActions}>
          <Badge tone={complete ? "success" : "neutral"} title="Approved frames">{run.approved}/{run.total || "—"} approved</Badge>
          <Badge title="Drawings made for this run, rejected ones included">{attempts} attempts</Badge>
          {run.approved > 0 ? (
            <Button
              size="sm"
              variant={complete ? "ai" : "outline"}
              disabled={!canOpen || opening || acting}
              onClick={() => void openInFlipbook()}
              title={canOpen ? `Copies the first ${wholeSeconds} s of approved frames into a new editable Flipbook.` : "Flipbook works in whole seconds: approve at least one second of frames in order."}
            >
              {opening ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />}
              Open in Flipbook
            </Button>
          ) : null}
          {run.approved > 0 ? (
            <Button size="sm" variant="ghost" asChild>
              <a href={rotoscopeUrls.zip(run.id)} download><HugeiconsIcon icon={Download02Icon} size={14} strokeWidth={1.75} />PNGs</a>
            </Button>
          ) : null}
          {run.phase === "generating" || run.phase === "stopping" ? (
            <Button size="sm" variant="ghost" disabled={acting || run.phase === "stopping"} onClick={() => void act("Couldn’t stop", () => rotoscopeApi.stop(run.id))}>
              {run.phase === "stopping" ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />}
              {run.phase === "stopping" ? "Stopping after this drawing" : "Stop"}
            </Button>
          ) : null}
        </div>
      </div>

      {run.phase === "preparing" ? (
        <div className={fb.progress}>
          <ol className={fb.steps} aria-label="Progress">
            {PREPARE_STEPS.map((step, position) => {
              const reached = run.log.some((line) => line.includes(step.key));
              const done = reached && (position === PREPARE_STEPS.length - 1 ? false : run.log.some((line) => line.includes(PREPARE_STEPS[position + 1].key)));
              const state = done ? "done" : reached || (position === 0 && !run.log.length) ? "active" : "todo";
              return <Step key={step.key} state={state} label={step.label} />;
            })}
          </ol>
          <p className={fb.hint} role="status">Cutting the video into frames, measuring every pose and reading your character. Nothing is drawn yet.</p>
        </div>
      ) : live ? (
        <div className={fb.progress}>
          <ol className={fb.steps} aria-label="Progress">
            {LIVE_STEPS.map((step, position) => {
              const at = LIVE_STEPS.findIndex((entry) => entry.stage === live.stage);
              const finished = live.stage === "approved" || live.stage === "rejected";
              return <Step key={step.stage} state={finished || position < at ? "done" : position === at ? "active" : "todo"} label={step.label} />;
            })}
          </ol>
          <p className={fb.hint} role="status">Frame {live.frame} of {run.total} · attempt {live.tries} of {run.maxAttempts} · {LIVE_LABEL[live.stage]}</p>
        </div>
      ) : null}

      {notice}

      <div className={styles.workspace} data-dock={dockOpen} data-wide={dockTab === "preview"}>
        <div className={styles.stage}>
          <RotoscopeCanvas
            key={run.id}
            run={run}
            selected={selected?.index ?? null}
            onSelect={pick}
            dockOpen={dockOpen}
            onToggleDock={() => setDockOpen((open) => !open)}
            viewing={dockTab === "frame" ? viewing : null}
            actions={canvasActions}
            onPickAttempt={(frame, attempt) => {
              setPicked(frame);
              setAttemptPick({ frame, attempt });
              setDockTab("frame");
              setDockOpen(true);
            }}
          />
          {comparing && selected ? (
            <CompareSheet
              run={run}
              frame={selected}
              initialAttempt={viewing?.frame === selected.index ? viewing.attempt : null}
              onFrame={pick}
              canApprove={run.phase === "ready" && (selected.status === "approved" || selected.index === next)}
              busy={acting}
              onApprove={(attempt) => void act("Couldn’t approve", () => rotoscopeApi.approve(run.id, selected.index, attempt))}
              onClose={() => setComparing(false)}
            />
          ) : null}
        </div>

        <aside className={styles.dock} data-open={dockOpen} aria-label="Run inspector">
          <div className={styles.dockInner}>
            <div className={styles.dockHead}>
              <SlidingTabs
                className={`${composer.tabs} ${styles.dockTabs}`}
                tabs={[{ id: "frame", label: "Frame" }, ...(run.frames.length ? [{ id: "preview", label: "Preview" }] : []), { id: "run", label: "Run" }]}
                value={dockTab}
                onValueChange={(id) => setDockTab(id === "run" ? "run" : id === "preview" ? "preview" : "frame")}
              />
              <Button size="icon-xs" variant="ghost" aria-label="Hide inspector" onClick={() => setDockOpen(false)}>
                <HugeiconsIcon icon={PanelRightCloseIcon} size={15} strokeWidth={1.75} />
              </Button>
            </div>

            <ScrollArea className={styles.dockScroll} viewportClassName={styles.dockViewport} contentClassName={styles.dockContent}>
              {/* Keyed by what it shows, so a new tab or frame eases in instead of replacing the old one on the spot. */}
              <div key={dockTab === "frame" ? `frame-${selected?.index ?? 0}` : dockTab} className={styles.swap}>
                {dockTab === "preview" && run.frames.length ? (
                  <RotoscopePlayer
                    frames={playable}
                    fps={run.fps}
                    live={liveStage}
                    compact
                    focus={selected ? {
                      index: selected.index,
                      source: rotoscopeUrls.media(run.id, "source", selected.index),
                      drawing: selected.status === "approved" ? `${rotoscopeUrls.media(run.id, "frame", selected.index)}&v=${selected.approvedAttempt}`
                        : selected.attempts.length ? rotoscopeUrls.media(run.id, "attempt", selected.index, selected.attempts.at(-1)!.attempt) : null,
                    } : null}
                    onSelect={pick}
                    strip={null}
                  />
                ) : dockTab === "frame" ? (
                  selected ? (
                    <Inspector
                      key={selected.index}
                      requested={attemptPick?.frame === selected.index ? attemptPick : null}
                      onCompare={() => setComparing(true)}
                      onViewing={(attempt) => setViewing({ frame: selected.index, attempt })}
                      run={run}
                      frame={selected}
                      following={picked === null && live?.frame === selected.index}
                      canApprove={run.phase === "ready" && (selected.status === "approved" || selected.index === next)}
                      canCorrect={run.phase === "ready"}
                      busy={acting}
                      onApprove={(attempt) => void act("Couldn’t approve", () => rotoscopeApi.approve(run.id, selected.index, attempt))}
                      onCorrect={(attempt, note) => correct(selected.index, attempt, note)}
                      onFollow={() => setPicked(null)}
                    />
                  ) : run.phase === "preparing" ? <InspectorSkeleton /> : (
                    <p className={fb.hint}>Pick a frame on the canvas to review it.</p>
                  )
                ) : (
                  <div className={styles.runPanels}>
                    <section className={fb.panel} aria-labelledby="ro-character">
                      <div className={fb.panelHead}><h2 id="ro-character" className={fb.panelTitle}>Character</h2></div>
                      <div className={fb.referencePair}>
                        <figure>
                          <span className={fb.referenceImage}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- the run's character */}
                            <img src={rotoscopeUrls.media(run.id, "character")} alt="Your character" />
                          </span>
                          <figcaption>Reference</figcaption>
                        </figure>
                        <figure>
                          <span className={fb.referenceImage}>
                            {selected ? (
                              // eslint-disable-next-line @next/next/no-img-element -- the selected video frame
                              <img src={rotoscopeUrls.media(run.id, "source", selected.index)} alt={`Video frame ${selected.index}`} />
                            ) : <Skeleton className={fb.working} />}
                          </span>
                          <figcaption>Video · frame {selected?.index ?? "—"}</figcaption>
                        </figure>
                      </div>
                      <dl className={fb.metrics}>
                        <div><dt>Frame rate</dt><dd>{run.fps} per second</dd></div>
                        <div><dt>Segment</dt><dd>{segment}</dd></div>
                        <div><dt>Frames</dt><dd>{run.total || "—"}</dd></div>
                        <div><dt>Attempts per frame</dt><dd>up to {run.maxAttempts}</dd></div>
                      </dl>
                      <div className={styles.optionRow}>
                        <span>
                          <span className="block text-foreground">Two drawings per attempt</span>
                          <span className="block text-muted-foreground">{run.dualAvailable ? "Muse Image and Higgsfield both draw each attempt; the one that measures closer to the pose goes on to the checks. Twice the drawing cost." : "Needs Higgsfield on the server (HF_CREDENTIALS in .env.local)."}</span>
                        </span>
                        <Switch checked={dual && run.dualAvailable} disabled={!run.dualAvailable || working} onCheckedChange={setDual} label="Two drawings per attempt with Higgsfield" />
                      </div>
                      <div className={styles.optionRow}>
                        <span>
                          <span className="block text-foreground">Pose guides</span>
                          <span className="block text-muted-foreground">Redraw them with the latest guide code (limb lengths, head, shoulders). Approved frames stay; frames drawn afterwards use the new guides.</span>
                        </span>
                        <Button size="sm" variant="outline" disabled={acting || working} onClick={() => void act("Couldn’t redraw the pose guides", () => rotoscopeApi.rebuildGuides(run.id))}>Rebuild</Button>
                      </div>
                      {run.phase === "ready" && !complete && run.total ? (
                        <div className={fb.cta}>
                          <p className="text-xs text-muted-foreground">{!started ? `Next: ${run.total} drawings, one per frame, in order.` : next === 1 ? "Frame 1 gets fresh attempts; its rejected ones stay in its history." : next === 2 ? "Frame 1 stays as it is; drawing continues at frame 2." : `Frames 1–${(next ?? 1) - 1} stay as they are; drawing continues at frame ${next}.`}</p>
                          <Button className="w-full" variant="ai" disabled={acting} onClick={draw}>
                            {acting ? <Spinner /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />}
                            {started ? `Resume from frame ${next}` : `Draw ${run.total} frames`}
                          </Button>
                        </div>
                      ) : null}
                    </section>

                    <section className={fb.panel} aria-labelledby="ro-checks">
                      <div className={fb.panelHead}><h2 id="ro-checks" className={fb.panelTitle}>Quality checks</h2></div>
                      <p className={fb.hint}>A frame is approved only when every check passes. After {run.maxAttempts} failed attempts the run stops on that frame; nothing after it is drawn until you resume or approve an attempt yourself.</p>
                      <ul className={fb.checkList}>
                        {CHECKS.map((check) => <li key={check.name} data-source="review"><span className="text-foreground">{check.label}.</span> {check.note}</li>)}
                      </ul>
                    </section>

                    {run.log.length ? (
                      <section className={fb.panel}>
                        <Disclosure title="Activity">
                          <pre className={styles.log}>{run.log.slice(-30).join("\n")}</pre>
                        </Disclosure>
                      </section>
                    ) : null}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** One step of a progress row, drawn like Flipbook's: a tick when done, a spinner while active. */
function Step({ state, label }: { readonly state: "done" | "active" | "todo"; readonly label: string }) {
  return (
    <li data-state={state} aria-current={state === "active" ? "step" : undefined}>
      <span className={fb.stepDot} aria-hidden>{state === "done" ? <HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={2.4} /> : state === "active" ? <Spinner className="size-3" /> : null}</span>
      <span>{label}</span>
    </li>
  );
}

// ── Inspector ───────────────────────────────────────────────────────────────

type InspectView = "drawing" | "video" | "guide" | "note";

function Inspector({ run, frame, requested, onViewing, onCompare, following, canApprove, canCorrect, busy, onApprove, onCorrect, onFollow }: {
  readonly run: RotoscopeRun;
  readonly frame: RotoscopeFrame;
  /** An attempt chosen elsewhere (the canvas tray) to show first. */
  readonly requested: { readonly attempt: number } | null;
  readonly onViewing: (attempt: number | null) => void;
  readonly onCompare: () => void;
  readonly following: boolean;
  readonly canApprove: boolean;
  /** Pencil notes can be left while the run is idle. */
  readonly canCorrect: boolean;
  readonly busy: boolean;
  readonly onApprove: (attempt: number) => void;
  readonly onCorrect: (attempt: number, note: { comment: string; marks: Blob; redraw: boolean }) => void;
  readonly onFollow: () => void;
}) {
  const live = run.live?.frame === frame.index ? run.live : null;
  const state = frameState(run, frame);
  const recorded = [...frame.attempts].reverse();
  const [chosen, setChosen] = useState<number | null>(requested?.attempt ?? null);
  useEffect(() => { if (requested) { setChosen(requested.attempt); setInspect("drawing"); } }, [requested]);
  const [inspect, setInspect] = useState<InspectView>("drawing");
  const [marking, setMarking] = useState(false);
  // The attempt in progress shows first while it is being checked; otherwise the approved or latest one.
  const liveAttempt = live?.image && !frame.attempts.some((entry) => entry.attempt === live.attempt) ? live.attempt : null;
  const attempt = chosen ?? liveAttempt ?? frame.approvedAttempt ?? recorded[0]?.attempt ?? null;
  const record = frame.attempts.find((entry) => entry.attempt === attempt) ?? null;
  useEffect(() => { onViewing(attempt); }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- onViewing is a fresh closure each render; only a change of attempt matters
  const view: InspectView = inspect === "note" && !frame.correction ? "drawing" : inspect;
  const drawing = attempt !== null ? rotoscopeUrls.media(run.id, "attempt", frame.index, attempt) : null;
  const image = view === "video" ? rotoscopeUrls.media(run.id, "source", frame.index)
    : view === "guide" ? rotoscopeUrls.guide(run, frame.index)
      : view === "note" ? `${rotoscopeUrls.media(run.id, "correction", frame.index)}&v=${encodeURIComponent(frame.correction?.at ?? "")}`
        : drawing;
  const canMark = canCorrect && record !== null && drawing !== null;

  // Any one of the frame's pictures can open large; the arrow keys walk the others, and the inspector follows.
  const [zoomed, setZoomed] = useState(false);
  const noteImage = `${rotoscopeUrls.media(run.id, "correction", frame.index)}&v=${encodeURIComponent(frame.correction?.at ?? "")}`;
  const zoomViews: InspectView[] = [...(drawing ? ["drawing" as const] : []), "video", "guide", ...(frame.correction ? ["note" as const] : [])];
  const zoomItems: LightboxMedia[] = zoomViews.map((id) => id === "video"
    ? { kind: "image", src: rotoscopeUrls.media(run.id, "source", frame.index), alt: "Video frame", caption: `Frame ${frame.index} · Video` }
    : id === "guide"
      ? { kind: "image", src: rotoscopeUrls.guide(run, frame.index), alt: "Pose guide", caption: `Frame ${frame.index} · Pose guide` }
      : id === "note"
        ? { kind: "image", src: noteImage, alt: "Your pencil marks", caption: `Frame ${frame.index} · Your note` }
        : { kind: "image", src: drawing ?? "", alt: `Attempt ${attempt}`, caption: `Frame ${frame.index} · Drawing · attempt ${attempt}`, transparent: true });

  return (
    <section className={fb.panel} aria-labelledby="ro-inspector">
      <div className={fb.panelHead}>
        <h2 id="ro-inspector" className={fb.panelTitle}>Frame {frame.index} · {time(run, frame.index)}</h2>
        <div className={styles.panelActions}>
          <Button type="button" size="sm" variant="ghost" onClick={onCompare} title="Video, pose guide and drawing side by side">
            <HugeiconsIcon icon={LayoutThreeColumnIcon} size={14} strokeWidth={1.75} />Compare
          </Button>
          <Badge tone={state === "approved" ? "success" : state === "drawing" ? "info" : state === "halted" || state === "rejected" ? "warning" : "neutral"}>{state === "drawing" ? "Live" : STATE_LABEL[state]}</Badge>
        </div>
      </div>
      <SlidingTabs
        className={composer.tabs}
        tabs={[{ id: "drawing", label: "Drawing" }, { id: "video", label: "Video" }, { id: "guide", label: frame.correction ? "Guide" : "Pose guide" }, ...(frame.correction ? [{ id: "note", label: "Note" }] : [])]}
        value={view}
        onValueChange={(id) => { setInspect(id as InspectView); setMarking(false); }}
      />
      {marking && canMark && record && drawing ? (
        <PencilNote
          image={drawing}
          busy={busy}
          onCancel={() => setMarking(false)}
          onSend={(note) => { setMarking(false); onCorrect(record.attempt, note); }}
        />
      ) : image ? (
        <ZoomButton className={`${fb.inspect} ${styles.inspectFrame}`} data-transparent={view === "drawing" ? "" : undefined} label="Open larger" onOpen={() => setZoomed(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- from the run's media route */}
          <img key={image} className={styles.arrive} src={image} alt={view === "video" ? "Video frame" : view === "guide" ? "Pose guide on your character's proportions" : view === "note" ? "Your pencil marks on the earlier drawing" : `Attempt ${attempt}`} draggable={false} />
        </ZoomButton>
      ) : (
        <div className={`${fb.inspect} ${styles.inspectFrame}`}>
          {live ? (
            <>
              <Skeleton className={fb.working} />
              <span className={fb.workingLabel}>{LIVE_LABEL[live.stage]}</span>
            </>
          ) : <span className={fb.stripEmpty}>Not drawn yet</span>}
        </div>
      )}
      <MediaLightbox
        items={zoomItems}
        index={zoomed ? Math.max(0, zoomViews.indexOf(view)) : null}
        onIndexChange={(next) => setInspect(zoomViews[next])}
        onClose={() => setZoomed(false)}
      />
      {frame.correction ? <p className={fb.hint}>Your note on attempt {frame.correction.attempt}, for this frame’s next drawing: “{frame.correction.comment}”</p> : null}
      {canMark && !marking && view === "drawing" ? (
        <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={() => setMarking(true)}>
          <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />Mark &amp; comment attempt {record?.attempt}
        </Button>
      ) : null}

      {live ? (
        <div className={styles.liveRow} role="status">
          <Spinner className="size-3.5" />
          <span>Attempt {live.tries} of {run.maxAttempts} · {LIVE_LABEL[live.stage]}</span>
        </div>
      ) : null}
      {!following && run.live ? <Button size="sm" variant="ghost" className="w-fit" onClick={onFollow}>Follow frame {run.live.frame} live</Button> : null}

      {frame.attempts.length || liveAttempt ? (
        <div className={fb.controlField}>
          <span className={fb.sectionLabel}>Attempts</span>
          <div className={fb.chips} role="group" aria-label="Attempts">
            {liveAttempt ? <ToggleChip size="xs" selected={attempt === liveAttempt} onClick={() => setChosen(liveAttempt)}><Spinner className="size-3" />Now</ToggleChip> : null}
            {recorded.map((entry) => (
              <ToggleChip key={entry.attempt} size="xs" selected={attempt === entry.attempt} onClick={() => { setChosen(entry.attempt); setInspect("drawing"); }}>
                <HugeiconsIcon icon={frame.approvedAttempt === entry.attempt ? Tick02Icon : entry.passed ? Tick02Icon : Cancel01Icon} size={12} strokeWidth={2} />
                {entry.attempt}
              </ToggleChip>
            ))}
          </div>
          {/* The checks can be wrong either way: the person's choice stands, for the next open frame or one already approved. */}
          {canApprove && record && frame.approvedAttempt !== record.attempt ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={busy}
              onClick={() => onApprove(record.attempt)}
              title="Use this drawing for the frame, whatever the checks said. The other attempts stay in its history."
            >
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={1.75} />
              {frame.approvedAttempt === null ? `Approve attempt ${record.attempt}` : `Use attempt ${record.attempt} instead`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {record ? (
        <div className={fb.checks}>
          <span className={fb.sectionLabel}>Attempt {record.attempt}{frame.approvedAttempt === record.attempt ? ` · approved${frame.manual ? " by you" : ""}` : record.passed ? "" : " · rejected"}</span>
          <ul className={styles.checkRows}>
            {record.checks.map((check) => (
              <li key={check.name} data-passed={check.passed}>
                <span className={styles.checkIcon} aria-hidden><HugeiconsIcon icon={check.passed ? Tick02Icon : Cancel01Icon} size={11} strokeWidth={2.2} /></span>
                <span className="min-w-0">
                  <span className={styles.checkName}>{CHECK_LABEL[check.name] ?? check.name}</span>
                  <span className={styles.checkDetail}>{check.detail}</span>
                </span>
              </li>
            ))}
            {!record.checks.some((check) => check.name === "review") && !record.passed ? <li data-passed="skipped"><span className={styles.checkIcon} aria-hidden>–</span><span className={styles.checkDetail}>Visual review skipped: a measured check failed first.</span></li> : null}
          </ul>
        </div>
      ) : liveAttempt ? (
        <p className={fb.hint}>The checks appear here when this attempt is judged.</p>
      ) : !frame.attempts.length && !live ? (
        <p className={fb.hint}>{state === "pending" ? "This frame hasn’t been drawn yet. Frames are drawn in order." : ""}</p>
      ) : null}
    </section>
  );
}

function InspectorSkeleton() {
  return (
    <section className={fb.panel} aria-busy="true" aria-label="Loading frame">
      <Skeleton shape="text" className="w-28" />
      <Skeleton className="h-[360px] w-full rounded-xl" />
      <Skeleton shape="text" className="w-40" />
    </section>
  );
}

export function RotoscopeEditorSkeleton() {
  return (
    <div className={fb.editor} aria-busy="true" aria-label="Loading run">
      <div className={fb.editorHead}><div className={fb.skeletonLines}><Skeleton shape="text" className="w-40" /><Skeleton shape="text" className="h-6 w-64" /></div></div>
      <div className={styles.workspace}>
        <div className={styles.stage}><Skeleton className={styles.skeletonCanvas} /></div>
      </div>
    </div>
  );
}
