"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { ErrorBanner } from "../../components/ui/error-banner";
import { Switch } from "../../components/ui/switch";
import { formatBytes } from "../../shared/media";
import type { FlowStepId } from "../../shared/pipeline";
import type { RenderParams, RenderResult } from "../../shared/render";
import { ACTIVE_JOB_STATUSES, type EditJob, type EffectId, type VideoAsset } from "../../shared/schemas";
import { frameAt, hitTest } from "../../shared/tracking";
import { Composer } from "./composer";
import { FlowRail } from "./flow-rail";
import { ApiRequestError, jobApi, useJob } from "./job-client";
import { DownloadButton, ProcessingPanel, ReadyPanel, ResultPanel, SelectionPanel } from "./job-panel";
import { CompareStage } from "./compare-stage";
import { TrackingOverlay } from "./tracking-overlay";
import { VideoStage } from "./video-stage";

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
}: {
  readonly video: VideoAsset;
  readonly effect: EffectId;
  readonly onEffectChange: (effect: EffectId) => void;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onReset: () => void;
}) {
  const { job, setJob, tracking, pollError, reset } = useJob(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [pending, setPending] = useState<readonly string[]>([]);
  const [point, setPoint] = useState<{ x: number; y: number; frameIndex: number } | null>(null);
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<RenderParams | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);

  // The effect controls start from the parameters of the render on screen.
  const renderKey = job?.render?.key ?? null;
  if (renderKey !== draftFor) {
    setDraftFor(renderKey);
    setDraft(job?.render?.params ?? null);
  }

  // Sync the local choice with the server's whenever a new selection round starts.
  const selectionKey = job ? `${job.id}:${job.segmentationId}:${job.status}:${job.selection.join(",")}` : null;
  if (selectionKey !== pendingFor) {
    setPendingFor(selectionKey);
    setPending(job?.selection ?? []);
    if (job?.status !== "awaiting_selection") setPoint(null);
  }

  const run = async (task: () => Promise<EditJob>) => {
    setBusy(true);
    setFailure(null);
    try {
      setJob(await task());
    } catch (error) {
      setFailure(error instanceof ApiRequestError ? error.message : "No pudimos completar la acción. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => run(() => jobApi.create({ videoId: video.id, effect, prompt }));

  const active = job ? ACTIVE_JOB_STATUSES.includes(job.status) : false;
  const selecting = job?.status === "awaiting_selection";
  const showComposer = !job || ["failed", "canceled", "awaiting_clarification"].includes(job.status);
  const showOverlay = tracking && job && !active && (selecting || job.status === "ready_to_render" || diagnostic);
  const result = job?.status === "completed" && job.render ? { ...job, render: job.render } : null;
  const panelKey = active ? "processing" : selecting ? "selecting" : job?.status === "ready_to_render" ? "ready" : result ? "result" : "compose";

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
    <main className={cn("mx-auto grid w-full max-w-[1440px] flex-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start", result && "pb-28 lg:pb-6")}>
      <section aria-label="Video" className="flex min-w-0 flex-col gap-3">
        {stageRender && !diagnostic ? (
          <CompareStage
            key={stageRender.key}
            render={stageRender}
            updating={job?.status === "rendering" ? { progress: job.progress, label: job.detail ?? "Actualizando" } : null}
          />
        ) : (
          <VideoStage
            key={video.id}
            video={video}
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
                  Fotograma {frameIndex + 1}/{tracking.frameCount} · {currentFrame ? `${currentFrame.objects.length} máscara${currentFrame.objects.length === 1 ? "" : "s"}` : "sin máscara"}
                  <br />
                  SAM {tracking.outcome.status === "completed" ? "completo" : `incompleto (${tracking.outcome.reason})`} · {tracking.frames.length} fotogramas con datos
                  {tracking.missingFrames.length ? ` · ${tracking.missingFrames.length} sin detección` : ""}
                </>
              ) : null
            }
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FlowRail current={flowStep(job)} />
          {tracking && job && !active ? (
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={diagnostic} onCheckedChange={setDiagnostic} label="Ver tracking" />
              <span aria-hidden>Ver tracking</span>
            </span>
          ) : null}
        </div>
      </section>

      <aside className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] lg:sticky lg:top-22">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium" title={video.originalName}>
              {video.originalName}
            </h1>
            <p className="mt-1 text-xs leading-5 text-muted-foreground tabular-nums">
              {video.source.container.toUpperCase()} · {video.source.codec} · {formatBytes(video.source.sizeBytes)}
              <br />
              Original {video.source.width}×{video.source.height} · {video.source.fps} fps · {video.source.durationSeconds.toFixed(1)} s
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onReset} disabled={active} aria-label="Quitar video y subir otro">
            <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.75} />
          </Button>
        </div>
        <div className="h-px bg-border" />

        <motion.div
          key={panelKey}
          ref={panelRef}
          tabIndex={-1}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
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

          {job?.status === "ready_to_render" ? (
            <ReadyPanel
              job={job}
              frameCount={video.normalized.frameCount}
              onChangeSelection={() => void run(() => jobApi.reopen(job.id))}
              onNewInstruction={reset}
              onRender={() => void run(() => jobApi.render(job.id))}
              busy={busy}
            />
          ) : null}

          {result && draft ? (
            <ResultPanel
              job={result}
              draft={draft}
              onDraftChange={setDraft}
              onApply={() => void run(() => jobApi.render(result.id, draft))}
              busy={busy}
              onChangeSelection={() => void run(() => jobApi.reopen(result.id))}
              onNewInstruction={reset}
              onFillGaps={() => void run(() => jobApi.fill(result.id))}
            />
          ) : null}

          {showComposer ? (
            <>
              {job?.status === "failed" && job.error ? (
                <ErrorBanner message={job.error.message} onRetry={() => void submit()} onDismiss={reset} />
              ) : null}
              {job?.status === "awaiting_clarification" ? (
                <Alert tone="info" title="Necesitamos un detalle más">
                  {job.detail} Escríbelo en la instrucción y vuelve a generar.
                </Alert>
              ) : null}
              {job?.status === "canceled" ? (
                <Alert tone="info" size="sm">
                  Proceso cancelado. Lo ya calculado queda guardado: ajusta la instrucción y vuelve a generar.
                </Alert>
              ) : null}
              <Composer
                effect={effect}
                onEffectChange={onEffectChange}
                prompt={prompt}
                onPromptChange={onPromptChange}
                onSubmit={() => void submit()}
                canSubmit
                busy={busy}
              />
            </>
          ) : null}
        </motion.div>

        {failure || pollError ? <ErrorBanner message={failure ?? pollError} onDismiss={() => setFailure(null)} /> : null}
      </aside>

      {result ? (
        // On phones the panel sits below the video: keep the export in reach.
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[color-mix(in_srgb,var(--background)_94%,transparent)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-[10px] lg:hidden">
          <DownloadButton url={result.render.urls.download} />
        </div>
      ) : null}
    </main>
  );
}
