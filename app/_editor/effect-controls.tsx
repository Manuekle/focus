"use client";

import { useId, type CSSProperties } from "react";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { ToggleChip } from "../../components/ui/toggle-chip";
import {
  BackgroundBlurParamsSchema,
  BreakFrameParamsSchema,
  MotionEchoParamsSchema,
  SelectiveColorParamsSchema,
  type RenderParams,
} from "../../shared/render";
import { EFFECT_PLAN_EFFECTS, type EffectId, type PlanEffect } from "../../shared/schemas";

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="text-muted-foreground">
          {label}
        </label>
        <span className="tabular-nums">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-valuetext={format(value)}
        className="editor-scrubber w-full"
        style={{ "--scrub": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </div>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Switching the effect inside its family starts from that effect's defaults. */
function defaultsFor(effect: PlanEffect): RenderParams {
  switch (effect) {
    case "selective_color":
      return SelectiveColorParamsSchema.parse({ effect });
    case "background_blur":
      return BackgroundBlurParamsSchema.parse({ effect });
    case "break_frame":
      return BreakFrameParamsSchema.parse({ effect });
    case "motion_echo":
      return MotionEchoParamsSchema.parse({ effect });
  }
}

/** The few knobs each effect exposes. Every change re-renders from cached masks. */
export function EffectControls({
  family,
  value,
  onChange,
}: {
  readonly family: EffectId;
  readonly value: RenderParams;
  readonly onChange: (next: RenderParams) => void;
}) {
  const choices = EFFECT_PLAN_EFFECTS[family];
  return (
    <div className="flex flex-col gap-4">
      {choices.length > 1 ? (
        <SlidingTabs
          tabs={choices.map((effect) => ({ id: effect, label: effect === "selective_color" ? "Color selectivo" : "Fondo desenfocado" }))}
          value={value.effect}
          onValueChange={(id) => onChange(defaultsFor(id as PlanEffect))}
        />
      ) : null}

      {value.effect === "selective_color" ? (
        <Range label="Desaturación del fondo" value={value.intensity} min={0.2} max={1} step={0.05} format={percent} onChange={(intensity) => onChange({ ...value, intensity })} />
      ) : null}

      {value.effect === "background_blur" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Desenfoque</span>
          <SlidingTabs
            tabs={[
              { id: "low", label: "Suave" },
              { id: "medium", label: "Medio" },
              { id: "high", label: "Intenso" },
            ]}
            value={value.level}
            onValueChange={(id) => onChange({ ...value, level: id as typeof value.level })}
          />
        </div>
      ) : null}

      {value.effect === "break_frame" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Marco</span>
            <SlidingTabs
              tabs={[
                { id: "compact", label: "Compacto" },
                { id: "balanced", label: "Equilibrado" },
                { id: "wide", label: "Amplio" },
              ]}
              value={value.frameSize}
              onValueChange={(id) => onChange({ ...value, frameSize: id as typeof value.frameSize })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Fondo</span>
            <div className="flex gap-1.5">
              <ToggleChip size="xs" selected={value.background === "dark"} onClick={() => onChange({ ...value, background: "dark" })}>
                Oscuro
              </ToggleChip>
              <ToggleChip size="xs" selected={value.background === "light"} onClick={() => onChange({ ...value, background: "light" })}>
                Claro
              </ToggleChip>
            </div>
          </div>
        </>
      ) : null}

      {value.effect === "motion_echo" ? (
        <>
          <Range label="Estelas" value={value.trailCount} min={2} max={6} step={1} format={(count) => String(count)} onChange={(trailCount) => onChange({ ...value, trailCount })} />
          <Range label="Separación" value={value.trailSpacingMs} min={60} max={400} step={20} format={(ms) => `${ms} ms`} onChange={(trailSpacingMs) => onChange({ ...value, trailSpacingMs })} />
          <Range label="Intensidad" value={value.intensity} min={0.2} max={1} step={0.05} format={percent} onChange={(intensity) => onChange({ ...value, intensity })} />
        </>
      ) : null}

      <Range label="Suavizado del borde" value={value.feather} min={0} max={4} step={0.5} format={(px) => `${px} px`} onChange={(feather) => onChange({ ...value, feather })} />
    </div>
  );
}
