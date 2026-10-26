"use client";

import { Download04Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useState } from "react";
import { useToast } from "../../components/toast-provider";
import { cn } from "../../lib/utils";
import type { RenderParams, RenderResult } from "../../shared/render";
import type { EditJob, JobPhase, PlanEffect } from "../../shared/schemas";
import { EffectControls } from "./effect-controls";

export const PLAN_EFFECT_LABEL: Record<PlanEffect, string> = {
  selective_color: "Color selectivo",
  background_blur: "Fondo desenfocado",
  break_frame: "Break the Frame",
  motion_echo: "Motion Echo",
};

function Step({ state, title, model }: { readonly state: "done" | "active" | "pending"; readonly title: string; readonly model: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg border",
          state === "done" && "border-transparent bg-accent text-accent-foreground",
          state === "active" && "border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] text-primary",
          state === "pending" && "border-border text-muted-foreground",
        )}
      >
        {state === "done" ? <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} /> : state === "active" ? <Spinner className="size-3.5" /> : null}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{title}</span>
        <span className="block text-xs text-muted-foreground">{model}</span>
      </span>
    </li>
  );
}

const PHASES: readonly { readonly id: JobPhase; readonly title: string; readonly model: string }[] = [
  { id: "understanding", title: "Entender la edición", model: "Muse Spark" },
  { id: "finding", title: "Encontrar el sujeto", model: "SAM 3.1" },
  { id: "tracking", title: "Seguir el movimiento", model: "SAM 3.1 · fotograma a fotograma" },
  { id: "applying", title: "Aplicar el efecto", model: "Compositor Focus" },
  { id: "encoding", title: "Codificar el MP4", model: "FFmpeg · H.264" },
];

export function ProcessingPanel({ job, onCancel, canceling }: { readonly job: EditJob; readonly onCancel: () => void; readonly canceling: boolean }) {
  // Steps light up from the job's real phase; nothing advances on a timer.
  const current = Math.max(0, PHASES.findIndex((phase) => phase.id === job.phase));
  // A re-render (a previous result exists) reuses the stored plan and masks.
  const rerender = job.status === "rendering" && job.render !== null;
  const percent = Math.round(job.progress * 100);
  return (
    <section aria-label="Procesando" className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-medium">{job.status === "rendering" ? "Renderizando el efecto" : "Procesando tu instrucción"}</h2>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">“{job.request.prompt}”</p>
      </div>
      <ol className="flex flex-col gap-3">
        {PHASES.map((phase, index) => (
          <Step
            key={phase.id}
            state={index < current ? "done" : index === current ? "active" : "pending"}
            title={phase.title}
            model={
              phase.id === "understanding" && job.plan
                ? `Sujeto: ${job.plan.target.concept}`
                : rerender && index < 3
                  ? "Guardado, sin nueva llamada"
                  : phase.model
            }
          />
        ))}
      </ol>
      <div className="flex flex-col gap-2">
        <ProgressMeter value={percent} aria-label="Progreso" aria-valuetext={`${percent}%`} />
        <p role="status" className="text-xs text-muted-foreground tabular-nums">
          {job.detail ?? "Procesando…"}
        </p>
      </div>
      <Button variant="outline" onClick={onCancel} disabled={canceling} aria-busy={canceling}>
        {canceling ? <Spinner /> : null}
        Cancelar
      </Button>
    </section>
  );
}

export function SelectionPanel({
  job,
  frameCount,
  pending,
  onToggle,
  onSelectAll,
  onConfirm,
  unmatchedPoint,
  onSegmentPoint,
  busy,
}: {
  readonly job: EditJob;
  readonly frameCount: number;
  readonly pending: readonly string[];
  readonly onToggle: (objectId: string) => void;
  readonly onSelectAll: () => void;
  readonly onConfirm: () => void;
  readonly unmatchedPoint: boolean;
  readonly onSegmentPoint: () => void;
  readonly busy: boolean;
}) {
  const chosen = new Set(pending);
  return (
    <section aria-label="Elegir objeto" className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">Elige qué destacar</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {job.detail ?? "Haz clic sobre el sujeto en el video o elígelo en la lista."}
          {job.plan?.target.description ? ` Pista: ${job.plan.target.description}.` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Objetos detectados">
        {job.objects.map((object, index) => (
          <ToggleChip
            key={object.id}
            size="xs"
            selected={chosen.has(object.id)}
            onClick={() => onToggle(object.id)}
            title={`${object.framesPresent}/${frameCount} fotogramas${object.meanConfidence !== null ? ` · confianza ${object.meanConfidence.toFixed(2)}` : ""}`}
            className="tabular-nums"
          >
            {object.source === "point" ? "Punto" : "Objeto"} {index + 1}
          </ToggleChip>
        ))}
      </div>
      {job.objects.length > 1 ? (
        <button type="button" onClick={onSelectAll} className="w-fit text-xs text-primary hover:underline">
          Seleccionar los {job.objects.length}
        </button>
      ) : null}
      {unmatchedPoint ? (
        <div className="rounded-xl border border-border bg-muted p-3">
          <p className="text-xs leading-5 text-foreground">Ningún objeto detectado cubre ese punto.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onSegmentPoint} disabled={busy}>
            Segmentar este punto con SAM 3.1
          </Button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Hace una nueva llamada a Meta AI.</p>
        </div>
      ) : null}
      <Button onClick={onConfirm} disabled={pending.length === 0 || busy} aria-busy={busy}>
        {busy ? <Spinner /> : null}
        {pending.length > 1 ? `Usar ${pending.length} objetos` : "Usar selección"}
      </Button>
    </section>
  );
}

export function ReadyPanel({
  job,
  frameCount,
  onChangeSelection,
  onNewInstruction,
  onRender,
  busy = false,
}: {
  readonly job: EditJob;
  readonly frameCount: number;
  readonly onChangeSelection: () => void;
  readonly onNewInstruction: () => void;
  readonly onRender?: () => void;
  readonly busy?: boolean;
}) {
  const selected = job.objects.filter((object) => job.selection.includes(object.id));
  const coverage = Math.max(0, ...selected.map((object) => object.framesPresent));
  const reused = [job.reused.plan && "plan", job.reused.segmentation && "máscaras"].filter(Boolean).join(" y ");
  return (
    <section aria-label="Segmentación lista" className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
          <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
        </span>
        <h2 className="text-sm font-medium">Sujeto identificado y seguido</h2>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Sujeto</dt>
        <dd>{job.plan?.target.concept}</dd>
        <dt className="text-muted-foreground">Efecto</dt>
        <dd>{job.plan ? PLAN_EFFECT_LABEL[job.plan.effect] : "—"}</dd>
        <dt className="text-muted-foreground">Selección</dt>
        <dd>
          {selected.length} {selected.length === 1 ? "objeto" : "objetos"} de {job.objects.length}
        </dd>
        <dt className="text-muted-foreground">Seguimiento</dt>
        <dd className="tabular-nums">
          {coverage}/{frameCount} fotogramas
        </dd>
        {reused ? (
          <>
            <dt className="text-muted-foreground">Reutilizado</dt>
            <dd>{reused}, sin coste</dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">Las máscaras quedan guardadas para editar sin volver a llamar a Meta AI.</p>
      {onRender ? (
        <Button onClick={onRender} disabled={busy} aria-busy={busy}>
          {busy ? <Spinner /> : null}
          Renderizar efecto
        </Button>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {job.objects.length > 1 ? (
          <Button variant="outline" size="sm" onClick={onChangeSelection}>
            Cambiar selección
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onNewInstruction}>
          Nueva instrucción
        </Button>
      </div>
    </section>
  );
}

export function ResultPanel({
  job,
  draft,
  onDraftChange,
  onApply,
  busy,
  onChangeSelection,
  onNewInstruction,
  onFillGaps,
}: {
  readonly job: EditJob & { readonly render: RenderResult };
  readonly onFillGaps: () => void;
  readonly draft: RenderParams;
  readonly onDraftChange: (next: RenderParams) => void;
  readonly onApply: () => void;
  readonly busy: boolean;
  readonly onChangeSelection: () => void;
  readonly onNewInstruction: () => void;
}) {
  const render = job.render;
  const dirty = JSON.stringify(draft) !== JSON.stringify(render.params);
  return (
    <section aria-label="Resultado" className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
          <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{PLAN_EFFECT_LABEL[render.params.effect]} listo</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {render.width}×{render.height} · {render.fps} fps · {render.durationSeconds.toFixed(1)} s · {job.plan?.target.concept}
          </p>
        </div>
      </div>

      {/* Phones get the same button in the fixed bottom bar instead. */}
      <DownloadButton url={render.urls.download} className="hidden lg:flex" />

      {render.warnings.length ? (
        <Alert
          tone="warning"
          size="sm"
          role={null}
          action={
            render.framesWithoutMask > 0 ? (
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" onClick={onFillGaps} disabled={busy}>
                  Completar el seguimiento con SAM 3.1
                </Button>
                <span className="text-[11px] text-muted-foreground">Hace una nueva llamada a Meta AI, solo para los fotogramas que faltan.</span>
              </div>
            ) : undefined
          }
        >
          {render.warnings.join(" ")}
        </Alert>
      ) : null}

      <div className="h-px bg-border" />
      <EffectControls family={job.request.effect} value={draft} onChange={onDraftChange} />
      <Button variant="secondary" onClick={onApply} disabled={!dirty || busy} aria-busy={busy}>
        {busy ? <Spinner /> : null}
        Aplicar ajustes
      </Button>
      <p className="-mt-3 text-[11px] leading-4 text-muted-foreground">Reutiliza las máscaras guardadas: no vuelve a llamar a Meta AI.</p>

      <div className="flex flex-wrap gap-2">
        {job.objects.length > 1 ? (
          <Button variant="outline" size="sm" onClick={onChangeSelection}>
            Cambiar selección
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onNewInstruction}>
          Nueva instrucción
        </Button>
      </div>
    </section>
  );
}

/**
 * Fetches the edited MP4 with real byte progress, then hands it to the browser
 * as a file. Success is reported only after every byte arrived.
 */
export function DownloadButton({ url, className }: { readonly url: string; readonly className?: string }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "downloading"; fraction: number | null } | { kind: "error"; message: string }>({ kind: "idle" });
  const { toast } = useToast();

  const start = async () => {
    setState({ kind: "downloading", fraction: 0 });
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error("http");
      const total = Number(response.headers.get("content-length")) || 0;
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "focus.mp4";
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        received += value.length;
        setState({ kind: "downloading", fraction: total ? received / total : null });
      }
      const href = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
      const link = document.createElement("a");
      link.href = href;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setState({ kind: "idle" });
      toast({ title: "MP4 descargado", description: name, status: "success" });
    } catch {
      setState({ kind: "error", message: "No pudimos descargar el video. Revisa la conexión y vuelve a intentarlo." });
    }
  };

  const downloading = state.kind === "downloading";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button size="lg" onClick={() => void start()} disabled={downloading} aria-busy={downloading}>
        {downloading ? <Spinner /> : <HugeiconsIcon icon={Download04Icon} size={16} strokeWidth={1.75} />}
        {downloading ? (state.fraction === null ? "Descargando…" : `Descargando · ${Math.round(state.fraction * 100)}%`) : "Descargar MP4"}
      </Button>
      {state.kind === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
