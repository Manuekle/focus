"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { FocusMark } from "../../components/icons/focus-mark";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FileUpload, type FileUploadItem } from "../../components/motion/file-upload";
import { ThemeToggle } from "../../components/motion/theme-toggle";
import { Button } from "../../components/ui/button";
import { ErrorBanner } from "../../components/ui/error-banner";
import { useToast } from "../../components/toast-provider";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  formatBytes,
  formatSeconds,
} from "../../shared/media";
import { ApiErrorBodySchema, type EffectId, type VideoAsset } from "../../shared/schemas";
import { Composer } from "./composer";
import { FlowRail } from "./flow-rail";
import { UploadError, checkFileLocally, uploadVideo } from "./upload";
import { VideoStage } from "./video-stage";

type Failure = { readonly message: string; readonly detail?: string; readonly retry?: () => void };

type Stage =
  | { readonly kind: "empty" }
  | { readonly kind: "uploading"; readonly item: FileUploadItem; readonly phase: "sending" | "preparing" }
  | { readonly kind: "ready"; readonly video: VideoAsset };

export function Workspace() {
  const [stage, setStage] = useState<Stage>({ kind: "empty" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [effect, setEffect] = useState<EffectId>("reality-shift");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const { toast } = useToast();

  const start = useCallback(async (file: File) => {
    setFailure(null);
    const base: FileUploadItem = { id: `${Date.now()}`, name: file.name, size: file.size, type: file.type, file };
    setStage({ kind: "uploading", phase: "sending", item: { ...base, status: "uploading", progress: 0 } });
    try {
      await checkFileLocally(file);
      const handle = uploadVideo(file, (fraction) => {
        setStage({
          kind: "uploading",
          // Bytes are in; FFprobe and FFmpeg are now running on the server.
          phase: fraction >= 1 ? "preparing" : "sending",
          item: { ...base, status: "uploading", progress: Math.round(fraction * 100) },
        });
      });
      abortRef.current = handle.abort;
      const video = await handle.promise;
      setStage({ kind: "ready", video });
      toast({ title: "Video listo", description: `${video.normalized.width}×${video.normalized.height} · ${formatSeconds(video.normalized.durationSeconds)}`, status: "success" });
    } catch (error) {
      setStage({ kind: "empty" });
      if (error instanceof UploadError && error.code === "aborted") return;
      setFailure({
        message: error instanceof Error ? error.message : "No pudimos subir el video.",
        detail: error instanceof UploadError ? error.detail : undefined,
        retry: () => void start(file),
      });
    } finally {
      abortRef.current = null;
    }
  }, [toast]);

  const reset = useCallback(async () => {
    if (stage.kind === "ready") {
      await fetch(`/api/videos/${stage.video.id}`, { method: "DELETE" }).catch(() => undefined);
    }
    setStage({ kind: "empty" });
    setFailure(null);
  }, [stage]);

  const submit = useCallback(async () => {
    if (stage.kind !== "ready") return;
    setSubmitting(true);
    setFailure(null);
    try {
      const response = await fetch("/api/edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: stage.video.id, effect, prompt }),
      });
      if (!response.ok) {
        const body = ApiErrorBodySchema.safeParse(await response.json().catch(() => null));
        setFailure({ message: body.success ? body.data.error.message : "No pudimos iniciar la edición. Vuelve a intentarlo." });
      }
    } catch {
      setFailure({ message: "Sin conexión con el servidor. Revisa tu red y vuelve a intentarlo." });
    } finally {
      setSubmitting(false);
    }
  }, [effect, prompt, stage]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-[color-mix(in_srgb,var(--background)_94%,transparent)] px-4 backdrop-blur-[10px] sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Focus — Inicio">
          <FocusMark className="h-[26px] w-auto" />
          <strong className="text-[22px] leading-none font-[650]">
            focus<span className="text-primary">.</span>
          </strong>
        </Link>
        <ThemeToggle variant="circle-blur" start="top-right" />
      </header>

      {stage.kind === "ready" ? (
        <main className="mx-auto grid w-full max-w-[1440px] flex-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <section aria-label="Video" className="flex min-w-0 flex-col gap-3">
            <VideoStage key={stage.video.id} video={stage.video} />
            <FlowRail current="describe" />
          </section>
          <aside className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] lg:sticky lg:top-22">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-medium" title={stage.video.originalName}>
                  {stage.video.originalName}
                </h1>
                <p className="mt-1 text-xs leading-5 text-muted-foreground tabular-nums">
                  {stage.video.source.container.toUpperCase()} · {stage.video.source.codec} · {formatBytes(stage.video.source.sizeBytes)}
                  <br />
                  Original {stage.video.source.width}×{stage.video.source.height} · {stage.video.source.fps} fps · {stage.video.source.durationSeconds.toFixed(1)} s
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => void reset()} aria-label="Quitar video y subir otro">
                <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.75} />
              </Button>
            </div>
            <div className="h-px bg-border" />
            <Composer
              effect={effect}
              onEffectChange={setEffect}
              prompt={prompt}
              onPromptChange={setPrompt}
              onSubmit={() => void submit()}
              disabled={false}
              busy={submitting}
            />
            {failure ? <ErrorBanner message={failure.message} detail={failure.detail} onDismiss={() => setFailure(null)} /> : null}
          </aside>
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            Editor de video con IA
          </p>
          <h1 className="mt-5 text-[clamp(40px,7vw,68px)] leading-[1.04] font-[550]">
            Make anything
            <br />
            stand out.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-7 text-muted-foreground">
            Sube un clip corto, describe qué quieres destacar y Focus aplica el efecto sobre el sujeto, fotograma a fotograma.
          </p>

          <div className="mt-10">
            <FileUpload
              variant="centered"
              multiple={false}
              maxFiles={1}
              accept={ACCEPT_ATTRIBUTE}
              disabled={stage.kind === "uploading"}
              value={stage.kind === "uploading" ? [stage.item] : []}
              onFilesAdded={(_items, files) => {
                if (files[0]) void start(files[0]);
              }}
              onRemove={() => abortRef.current?.()}
              title="Suelta tu video aquí"
              description={`MP4 o MOV · hasta ${MAX_DURATION_SECONDS} s · ${formatBytes(MAX_UPLOAD_BYTES)} máximo`}
              browseLabel="Elegir archivo"
              classNames={{ dropzone: "min-h-64" }}
            />
            {stage.kind === "uploading" ? (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                {stage.phase === "sending"
                  ? `Subiendo… ${stage.item.progress ?? 0}%`
                  : "Validando y normalizando el video (720p · 24 fps · H.264)…"}
              </p>
            ) : null}
            {failure ? (
              <ErrorBanner
                className="mt-4"
                message={failure.message}
                detail={failure.detail}
                onRetry={failure.retry}
                onDismiss={() => setFailure(null)}
              />
            ) : null}
          </div>

          <section aria-label="Edición" className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <Composer
              effect={effect}
              onEffectChange={setEffect}
              prompt={prompt}
              onPromptChange={setPrompt}
              onSubmit={() => undefined}
              disabled
              busy={false}
            />
          </section>
        </main>
      )}
    </div>
  );
}
