"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";
import { ArrowLeftRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { formatBytes } from "../../shared/media";
import type { FlowStepId } from "../../shared/pipeline";
import type { RenderParams, RenderResult } from "../../shared/render";
import { ACTIVE_JOB_STATUSES, SuggestionsSchema, type EditJob, type EffectId, type Suggestions, type VideoAsset } from "../../shared/schemas";
import { frameAt, hitTest } from "../../shared/tracking";
import { Composer } from "./composer";
import { EditorNotice } from "./editor-notice";
import { FlowRail } from "./flow-rail";
import { ApiRequestError, jobApi, useJob } from "./job-client";
import { DownloadButton, ProcessingPanel, ReadyPanel, ResultPanel, SelectionPanel } from "./job-panel";
import { CompareStage } from "./compare-stage";
import { TrackingOverlay } from "./tracking-overlay";
import { VideoStage } from "./video-stage";
import { editorErrorMessage } from "./messages";
import { EffectControls } from "./effect-controls";
import { temporalEffectsEnabled } from "../../shared/features";
import { prefersReducedMotion, useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import styles from "./editor-view.module.css";

function flowStep(job: EditJob | null): FlowStepId {
  switch (job?.status) {
    case "interpreting":
      return "identify";
    case "segmenting":
    case "awaiting_selection":
      return "track";
    case "ready_to_render":
    case "rendering":
      return "transform";
    case "completed":
      return "export";
    default:
      return "describe";
  }
}

export function EditorView({
  video,
  effect,
  onEffectChange,
  prompt,
  onPromptChange,
  onReset,
  initialJob = null,
  autostart = false,
  onLoginRequired,
  onJobChange,
  variant = "home",
}: {
  readonly video: VideoAsset;
  readonly effect: EffectId;
  readonly onEffectChange: (effect: EffectId) => void;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onReset: () => void;
  /** An edit to reopen (from a saved project). */
  readonly initialJob?: EditJob | null;
  /** Generate once on mount: the home page handed over an instruction. */
  readonly autostart?: boolean;
  /** No free edits left: the page asks for Facebook sign-in. */
  readonly onLoginRequired?: () => void;
  /** Every new job or status, so the page can refresh projects and quota. */
  readonly onJobChange?: (job: EditJob | null) => void;
  readonly variant?: "home" | "page";
}) {
  const { job, setJob, tracking, pollError, reset } = useJob(initialJob);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [pending, setPending] = useState<readonly string[]>([]);
  const [point, setPoint] = useState<{ x: number; y: number; frameIndex: number } | null>(null);
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<RenderParams | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [editingMomentFor, setEditingMomentFor] = useState<string | null>(null);
  const [freezeInvalid, setFreezeInvalid] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  // Ideas read from the clip (one cached Muse Spark call). Optional: on any
  // failure the composer keeps its static examples.
  const [suggestions, setSuggestions] = useState<{ videoId: string; value: Suggestions | null } | null>(null);
  useEffect(() => {
    let canceled = false;
    fetch(`/api/videos/${video.id}/suggestions`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const parsed = SuggestionsSchema.safeParse(body);
        if (!canceled) setSuggestions({ videoId: video.id, value: parsed.success ? parsed.data : null });
      })
      .catch(() => { if (!canceled) setSuggestions({ videoId: video.id, value: null }); });
    return () => { canceled = true; };
  }, [video.id]);
  const clipSuggestions = suggestions?.videoId === video.id ? suggestions.value : null;
  const suggestionsLoading = suggestions?.videoId !== video.id;

  useEffect(() => {
    editorRef.current?.focus({ preventScroll: true });
    const studio = document.getElementById("studio");
    const bounds = editorRef.current?.getBoundingClientRect();
    if (studio && bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
      studio.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "instant" : "smooth" });
    }
  }, []);

  // The effect controls start from the parameters of the render on screen.
  const draftSource = job?.status === "ready_to_render" || job?.status === "failed" ? job.params : job?.render?.params ?? job?.params;
  const draftKey = job ? `${job.id}:${JSON.stringify(draftSource)}` : null;
  if (draftKey !== draftFor) {
    setDraftFor(draftKey);
    setDraft(draftSource ?? null);
    setFreezeInvalid(false);
  }

  // Sync the local choice with the server's whenever a new selection round starts.
  const selectionKey = job ? `${job.id}:${job.segmentationId}:${job.status}:${job.selection.join(",")}` : null;
  if (selectionKey !== pendingFor) {
    setPendingFor(selectionKey);
    setPending(job?.selection ?? []);
    if (job?.status !== "awaiting_selection") setPoint(null);
  }

  // The instruction can move the job to another effect family (it asked for
  // a blur while Motion Echo was picked): the tabs follow the job.
  const jobFamily = job?.request.effect;
  useEffect(() => {
    if (jobFamily && jobFamily !== effect) onEffectChange(jobFamily);
    // Only when the job's family changes, never when the user switches tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobFamily]);

  const run = async (task: () => Promise<EditJob>) => {
    setBusy(true);
    setFailure(null);
    try {
      setJob(await task());
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "login_required" && onLoginRequired) onLoginRequired();
      else setFailure(error instanceof ApiRequestError ? error.message : "We couldn’t complete that action. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => run(() => jobApi.create({ videoId: video.id, effect, prompt }));

  // The instruction typed on the home page starts here, once.
  const autostarted = useRef(false);
  useEffect(() => {
    if (!autostart || autostarted.current || prompt.trim().length < 3) return;
    autostarted.current = true;
    void submit();
    // Mount-only: later prop changes never generate again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jobStatus = job?.status;
  const jobChangeRef = useRef(onJobChange);
  useEffect(() => {
    jobChangeRef.current = onJobChange;
  });
  useEffect(() => {
    jobChangeRef.current?.(job);
    // Reported per job and status, not per progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, jobStatus]);

  // The AI editor's message stays on screen while Muse Spark answers.
  const [chatPending, setChatPending] = useState<string | null>(null);
  const sendChat = async (jobId: string, message: string) => {
    setChatPending(message);
    setFailure(null);
    try {
      setJob(await jobApi.chat(jobId, message));
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : "The AI editor couldn’t answer. Try again.");
    } finally {
      setChatPending(null);
    }
  };

  const active = job ? ACTIVE_JOB_STATUSES.includes(job.status) : false;
  const temporalDraft = temporalEffectsEnabled() && draft?.effect === "time_freeze_echo" ? draft : null;
  const temporalRetry = Boolean(temporalDraft && job?.status === "failed" && job.selection.length);
  const ready = job?.status === "ready_to_render" || temporalRetry;
  const selecting = job?.status === "awaiting_selection";
  const showComposer = !job || (!temporalRetry && ["failed", "canceled", "awaiting_clarification"].includes(job.status));
  const showOverlay = tracking && job && !active && (selecting || job.status === "ready_to_render" || diagnostic);
  const result = job?.status === "completed" && job.render ? { ...job, render: job.render } : null;
  const panelKey = active ? "processing" : selecting ? "selecting" : ready ? "ready" : result ? "result" : "compose";
  const editingMoment = Boolean(temporalDraft && job && !active && (ready || (result && editingMomentFor === job.id)));
  const applyDraft = () => {
    if (!job) return;
    if (temporalDraft && temporalDraft.trigger.timestampMs === undefined) {
      setEditingMomentFor(job.id);
      setFreezeInvalid(true);
      return;
    }
    setEditingMomentFor(null);
    void run(() => jobApi.render(job.id, draft ?? undefined));
  };

  // The last finished render stays on stage while a new one is computed, so
  // changing a setting never collapses the player back to the source.
  const [shown, setShown] = useState<{ jobId: string; render: RenderResult } | null>(null);
  if (result && shown?.render.key !== result.render.key) setShown({ jobId: result.id, render: result.render });
  if (!job && shown) setShown(null);
  const stageRender = result?.render ?? (job && shown?.jobId === job.id && job.status === "rendering" ? shown.render : null);

  // When the panel swaps, the control that had focus is gone: move focus to
  // the new panel instead of letting it fall back to <body>.
  const panelRef = useRef<HTMLDivElement>(null);
  const previousPanel = useRef(panelKey);
  useEffect(() => {
    if (previousPanel.current === panelKey) return;
    previousPanel.current = panelKey;
    const focused = document.activeElement;
    if (!focused || focused === document.body || panelRef.current?.closest("aside")?.contains(focused)) {
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [panelKey]);
  const currentFrame = tracking ? frameAt(tracking, frameIndex) : undefined;

  return (
    <section id="editor" ref={editorRef} tabIndex={-1} aria-label="Clip editor" data-variant={variant} className={cn(styles.editor, result && "pb-28 lg:pb-0")}>
      <section aria-label="Video" className={styles.preview}>
        {stageRender && !diagnostic && !editingMoment ? (
          <CompareStage
            key={stageRender.key}
            render={stageRender}
            updating={job?.status === "rendering" ? { progress: job.progress, label: job.detail ?? "Updating" } : null}
          />
        ) : (
          <VideoStage
            key={video.id}
            video={video}
            freeze={editingMoment && temporalDraft ? {
              trigger: temporalDraft.trigger, suggestion: job?.temporalSuggestion ?? null, invalid: freezeInvalid, focus: Boolean(result),
              onChange: (trigger) => { setDraft({ ...temporalDraft, trigger }); setFreezeInvalid(false); },
            } : undefined}
            overlay={
              showOverlay
                ? (videoRef) => (
                    <TrackingOverlay
                      videoRef={videoRef}
                      tracking={tracking}
                      selection={selecting ? pending : job.selection}
                      mode={selecting ? "pick" : "view"}
                      diagnostic={diagnostic}
                      marker={point && point.frameIndex === frameIndex ? point : null}
                      onFrame={setFrameIndex}
                      onPick={(source, index) => {
                        const hit = hitTest(frameAt(tracking, index), source.x, source.y);
                        if (hit) {
                          setPoint(null);
                          setPending((current) => (current.includes(hit) ? current.filter((id) => id !== hit) : [...current, hit]));
                        } else {
                          setPoint({ ...source, frameIndex: index });
                        }
                      }}
                    />
                  )
                : undefined
            }
            hud={
              diagnostic && tracking ? (
                <>
                  Frame {frameIndex + 1}/{tracking.frameCount} · {currentFrame ? `${currentFrame.objects.length} mask${currentFrame.objects.length === 1 ? "" : "s"}` : "no mask"}
                  <br />
                  SAM {tracking.outcome.status === "completed" ? "complete" : `incomplete (${tracking.outcome.reason})`} · {tracking.frames.length} frames with data
                  {tracking.missingFrames.length ? ` · ${tracking.missingFrames.length} undetected` : ""}
                </>
              ) : null
            }
          />
        )}
        <div className={styles.fileRow}>
          <div className={styles.fileDetails}>
            <p className={styles.fileName} title={video.originalName}>{video.originalName}</p>
            {/* Duration lives in the player; this line carries what the player does not. */}
            <p className={styles.fileMeta}>{video.source.width}×{video.source.height} · {video.normalized.fps} fps · {formatBytes(video.source.sizeBytes)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} disabled={active} aria-label="Change clip">
            <HugeiconsIcon icon={ArrowLeftRightIcon} size={14} strokeWidth={1.5} />{variant === "page" ? "New clip" : "Change clip"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {job ? <FlowRail current={flowStep(job)} /> : null}
          {tracking && job && !active ? (
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={diagnostic} onCheckedChange={setDiagnostic} label="Show tracking" />
              <span aria-hidden>Show tracking</span>
            </span>
          ) : null}
        </div>
      </section>

      <aside className={styles.controls}>
        {variant === "home" ? <h2 className={styles.heading}>Make it your own.</h2> : null}
        <motion.div
          key={panelKey}
          ref={panelRef}
          tabIndex={-1}
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: EASE_OUT }}
          className="flex flex-col gap-5 outline-none"
        >
          {job && active ? (
            <ProcessingPanel job={job} canceling={busy} onCancel={() => void run(() => jobApi.cancel(job.id))} />
          ) : null}

          {job && selecting ? (
            <SelectionPanel
              job={job}
              frameCount={video.normalized.frameCount}
              pending={pending}
              busy={busy}
              unmatchedPoint={point !== null}
              onToggle={(id) => setPending((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))}
              onSelectAll={() => setPending(job.objects.map((object) => object.id))}
              onConfirm={() => void run(() => jobApi.select(job.id, pending))}
              onSegmentPoint={() => {
                if (point) void run(() => jobApi.refine(job.id, point.frameIndex, { x: point.x, y: point.y }));
              }}
            />
          ) : null}

          {job && ready ? (
            <ReadyPanel
              job={job}
              frameCount={video.normalized.frameCount}
              onChangeSelection={() => void run(() => jobApi.reopen(job.id))}
              onNewInstruction={reset}
              onRender={applyDraft}
              controls={temporalDraft ? <EffectControls family={job.request.effect} value={temporalDraft} onChange={setDraft} /> : undefined}
              busy={busy}
            />
          ) : null}

          {result && draft ? (
            <ResultPanel
              job={result}
              draft={draft}
              onDraftChange={setDraft}
              onApply={applyDraft}
              onEditFreezePoint={() => setEditingMomentFor(editingMomentFor === result.id ? null : result.id)}
              editingFreezePoint={editingMoment}
              busy={busy}
              onChangeSelection={() => void run(() => jobApi.reopen(result.id))}
              onNewInstruction={reset}
              onFillGaps={() => void run(() => jobApi.fill(result.id))}
              chat={{
                pending: chatPending,
                disabled: busy,
                onSend: (message) => void sendChat(result.id, message),
                onRestore: (messageId) => void run(() => jobApi.restore(result.id, messageId)),
                // Another subject needs new masks: a new edit, started in plain sight.
                onStartEdit: (instruction) => {
                  onPromptChange(instruction);
                  void run(() => jobApi.create({ videoId: video.id, effect, prompt: instruction }));
                },
              }}
            />
          ) : null}

          {showComposer ? (
            <>
              {job?.status === "failed" && job.error ? (
                <EditorNotice title="Edit couldn’t be completed" description={job.error.code === "unsupported_edit" || job.error.code === "no_match" ? job.error.message : editorErrorMessage(job.error.code)} action={{ label: "Retry", onClick: () => void submit() }} />
              ) : null}
              {job?.status === "awaiting_clarification" ? (
                <EditorNotice status="info" title="Add one more detail" description={`${job.detail ?? ""} Add it to your instruction and generate again.`.trim()} />
              ) : null}
              {job?.status === "canceled" ? (
                <EditorNotice status="info" title="Editing canceled" description="Your progress is saved. Adjust your instruction and generate again." duration={4200} />
              ) : null}
              <Composer
                effect={effect}
                onEffectChange={onEffectChange}
                prompt={prompt}
                onPromptChange={onPromptChange}
                onSubmit={() => void submit()}
                canSubmit
                busy={busy}
                suggestions={clipSuggestions}
                suggestionsLoading={suggestionsLoading}
              />
            </>
          ) : null}
        </motion.div>

        {failure ? <EditorNotice title="Action couldn’t be completed" description={failure} /> : null}
        {pollError ? <EditorNotice title="Connection interrupted" description={pollError} /> : null}
      </aside>

      {result ? (
        // On phones the panel sits below the video: keep the export in reach.
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[color-mix(in_srgb,var(--background)_94%,transparent)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-[10px] lg:hidden">
          <DownloadButton url={result.render.urls.download} />
        </div>
      ) : null}
    </section>
  );
}
