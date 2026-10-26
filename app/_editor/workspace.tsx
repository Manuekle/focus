"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE_OUT } from "../../lib/ease";
import { FocusMark } from "../../components/icons/focus-mark";
import { FileUpload, type FileUploadItem } from "../../components/motion/file-upload";
import { ThemeToggle } from "../../components/motion/theme-toggle";
import { ErrorBanner } from "../../components/ui/error-banner";
import { useToast } from "../../components/toast-provider";
import {
  ACCEPT_ATTRIBUTE,
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  formatBytes,
  formatSeconds,
} from "../../shared/media";
import { VideoAssetSchema, type EffectId, type VideoAsset } from "../../shared/schemas";
import { Composer } from "./composer";
import { EditorView } from "./editor-view";
import { UploadError, checkFileLocally, uploadVideo } from "./upload";

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
  const abortRef = useRef<(() => void) | null>(null);
  const { toast } = useToast();

  // The current video lives in the URL (?v=id), so a reload keeps the clip
  // and every cached plan and mask that belongs to it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("v");
    if (!id) return;
    fetch(`/api/videos/${encodeURIComponent(id)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const parsed = VideoAssetSchema.safeParse(body);
        if (parsed.success) setStage({ kind: "ready", video: parsed.data });
        else window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const url = stage.kind === "ready" ? `${window.location.pathname}?v=${stage.video.id}` : window.location.pathname;
    if (stage.kind !== "uploading" && `${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [stage]);

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
        <motion.div key={stage.video.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="flex flex-1 flex-col">
        <EditorView
          key={stage.video.id}
          video={stage.video}
          effect={effect}
          onEffectChange={setEffect}
          prompt={prompt}
          onPromptChange={setPrompt}
          onReset={() => void reset()}
        />
        </motion.div>
      ) : (
        <motion.main
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="mx-auto grid w-full max-w-[1180px] flex-1 content-start gap-x-14 gap-y-8 px-4 pt-12 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-start lg:pt-20"
        >
          <div className="lg:sticky lg:top-28">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              Editor de video con IA · Meta AI
            </p>
            <h1 className="mt-5 text-[clamp(40px,6vw,68px)] leading-[1.04] font-[550]">
              Make anything
              <br />
              stand out.
            </h1>
            <p className="mt-5 max-w-[40ch] text-[15px] leading-7 text-muted-foreground">
              Crea efectos de video imposibles con una sola frase.
            </p>
            <ol className="mt-8 hidden max-w-[44ch] flex-col gap-2.5 text-sm text-muted-foreground lg:flex">
              {["Suelta un clip corto.", "Describe qué quieres destacar.", "Mira la transformación y exporta el MP4."].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="w-5 shrink-0 text-xs leading-5 text-foreground tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
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
              browseLabel="o busca un archivo"
              classNames={{ dropzone: "min-h-52" }}
            />
            {stage.kind === "uploading" ? (
              <p role="status" className="-mt-1 text-xs text-muted-foreground tabular-nums">
                {stage.phase === "sending"
                  ? `Subiendo · ${stage.item.progress ?? 0}%`
                  : "Preparando el video: validación y normalización a 720p · 24 fps · H.264…"}
              </p>
            ) : null}
            {failure ? (
              <ErrorBanner message={failure.message} detail={failure.detail} onRetry={failure.retry} onDismiss={() => setFailure(null)} />
            ) : null}

            <section aria-label="Edición" className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
              <Composer
                effect={effect}
                onEffectChange={setEffect}
                prompt={prompt}
                onPromptChange={setPrompt}
                onSubmit={() => undefined}
                canSubmit={false}
                blockedReason="Sube un video para generar."
                busy={false}
              />
            </section>
          </div>
        </motion.main>
      )}
    </div>
  );
}
