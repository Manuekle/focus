"use client";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { cn } from "../../lib/utils";
import type { EditJob, PlanEffect } from "../../shared/schemas";

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

export function ProcessingPanel({ job, onCancel, canceling }: { readonly job: EditJob; readonly onCancel: () => void; readonly canceling: boolean }) {
  const interpreting = job.status === "interpreting";
  const percent = Math.round(job.progress * 100);
  return (
    <section aria-label="Procesando" className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-medium">Procesando tu instrucción</h2>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">“{job.request.prompt}”</p>
      </div>
      <ol className="flex flex-col gap-3">
        <Step state={interpreting ? "active" : "done"} title="Interpretar la instrucción" model={job.plan ? `Sujeto: ${job.plan.target.concept}` : "Muse Spark"} />
        <Step state={interpreting ? "pending" : "active"} title="Encontrar y seguir el sujeto" model="SAM 3.1 · fotograma a fotograma" />
      </ol>
      <div className="flex flex-col gap-2">
        <ProgressMeter value={percent} aria-label="Progreso del proceso" aria-valuetext={`${percent}%`} />
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
}: {
  readonly job: EditJob;
  readonly frameCount: number;
  readonly onChangeSelection: () => void;
  readonly onNewInstruction: () => void;
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
      <p className="text-xs leading-5 text-muted-foreground">
        Las máscaras quedan guardadas para editar sin volver a llamar a Meta AI. El render del efecto llega en la siguiente fase.
      </p>
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
