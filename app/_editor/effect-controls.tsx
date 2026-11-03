"use client";

import { useId, type CSSProperties } from "react";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Disclosure } from "../../components/ui/disclosure";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { cn } from "../../lib/utils";
import {
  ACCENT_LABEL,
  ACCENT_RGB,
  ASPECT_LABEL,
  AspectSchema,
  AccentColorSchema,
  LOOK_LABEL,
  LookSchema,
  TITLE_MAX,
  TITLE_TEXT_MAX,
  effectDefaults,
  type Delivery,
  type Finish,
  type Title,
  type RenderParams,
} from "../../shared/render";
import { EFFECT_PLAN_EFFECTS, type EffectId, type PlanEffect } from "../../shared/schemas";
import { temporalEffectsEnabled } from "../../shared/features";
import { TEMPORAL_BOUNDS } from "../../shared/temporal";

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

const CHOICE_LABEL: Partial<Record<PlanEffect, string>> = {
  selective_color: "Color",
  background_blur: "Blur",
  spotlight: "Spotlight",
  erase: "Remove",
  pixelate: "Pixelate",
};

/** Switching the effect inside its family starts from that effect's defaults, keeping the finish. */
function defaultsFor(effect: PlanEffect, finish: Finish, delivery: Delivery): RenderParams {
  return { ...effectDefaults(effect), finish, delivery } as RenderParams;
}

const POSITIONS: readonly { id: Title["position"]; label: string }[] = [{ id: "top", label: "Top" }, { id: "center", label: "Middle" }, { id: "bottom", label: "Bottom" }];
const SIZES: readonly { id: Title["size"]; label: string }[] = [{ id: "small", label: "Small" }, { id: "medium", label: "Medium" }, { id: "large", label: "Large" }];
const STYLES: readonly { id: Title["style"]; label: string }[] = [{ id: "plain", label: "Plain" }, { id: "shadow", label: "Shadow" }, { id: "box", label: "Box" }];

/** The output format and the titles drawn over the finished video. */
function DeliveryControls({ value, onChange, duration }: { readonly value: Delivery; readonly onChange: (next: Delivery) => void; readonly duration: number }) {
  const set = (patch: Partial<Delivery>) => onChange({ ...value, ...patch });
  const length = Math.max(1, Math.round(duration * 10) / 10);
  const updateTitle = (id: string, patch: Partial<Title>) => set({ titles: value.titles.map((title) => (title.id === id ? { ...title, ...patch } : title)) });
  const addTitle = () => {
    const start = 0;
    const title: Title = { id: `t${Date.now().toString(36)}${value.titles.length}`, text: "Your title", start, end: Math.min(length, 3), position: "bottom", size: "medium", color: "white", style: "shadow" };
    set({ titles: [...value.titles, title] });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Format</span>
        <SlidingTabs
          tabs={AspectSchema.options.map((aspect) => ({ id: aspect, label: ASPECT_LABEL[aspect] }))}
          value={value.aspect}
          onValueChange={(id) => set({ aspect: id as Delivery["aspect"] })}
        />
        {value.aspect !== "original" ? (
          <>
            <span className="mt-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground" aria-hidden>Follow the subject</span>
              <Switch checked={value.follow} onCheckedChange={(follow) => set({ follow })} label="Follow the subject" />
            </span>
            <p className="text-xs leading-4 text-muted-foreground">Crops the video to {ASPECT_LABEL[value.aspect]}. Without a tracked subject it crops from the center.</p>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Titles</span>
          <ToggleChip size="xs" selected={false} disabled={value.titles.length >= TITLE_MAX} onClick={addTitle}>Add title</ToggleChip>
        </div>
        {value.titles.map((title, index) => (
          <div key={title.id} className="flex flex-col gap-3 border-t border-border pt-3" role="group" aria-label={`Title ${index + 1}`}>
            <div className="flex items-center gap-2">
              <Input
                value={title.text}
                maxLength={TITLE_TEXT_MAX}
                aria-label={`Title ${index + 1} text`}
                placeholder="Title text"
                onChange={(event) => updateTitle(title.id, { text: event.currentTarget.value })}
              />
              <ToggleChip size="xs" selected={false} onClick={() => set({ titles: value.titles.filter((entry) => entry.id !== title.id) })} aria-label={`Remove title ${index + 1}`}>Remove</ToggleChip>
            </div>
            <Range label="Appears" value={title.start} min={0} max={length} step={0.1} format={(s) => `${s.toFixed(1)} s`} onChange={(start) => updateTitle(title.id, { start, end: Math.max(title.end, Math.min(length, start + 0.5)) })} />
            <Range label="Disappears" value={title.end} min={0} max={length} step={0.1} format={(s) => `${s.toFixed(1)} s`} onChange={(end) => updateTitle(title.id, { end, start: Math.min(title.start, Math.max(0, end - 0.5)) })} />
            <SlidingTabs tabs={POSITIONS.map((entry) => ({ ...entry }))} value={title.position} onValueChange={(id) => updateTitle(title.id, { position: id as Title["position"] })} />
            <SlidingTabs tabs={SIZES.map((entry) => ({ ...entry }))} value={title.size} onValueChange={(id) => updateTitle(title.id, { size: id as Title["size"] })} />
            <SlidingTabs tabs={STYLES.map((entry) => ({ ...entry }))} value={title.style} onValueChange={(id) => updateTitle(title.id, { style: id as Title["style"] })} />
            {title.style !== "box" ? (
              <div className="flex gap-2" role="radiogroup" aria-label="Title color">
                {AccentColorSchema.options.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={title.color === color}
                    aria-label={ACCENT_LABEL[color]}
                    title={ACCENT_LABEL[color]}
                    onClick={() => updateTitle(title.id, { color })}
                    className={cn(
                      "size-6 rounded-full border border-border outline-offset-2 transition-[box-shadow,transform] duration-150 hover:scale-110",
                      title.color === color && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    )}
                    style={{ background: `rgb(${ACCENT_RGB[color].join(" ")})` }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Grade, subject light, vignette, grain and letterbox: the same on every effect. */
function FinishControls({ value, onChange, subjectLight = true }: { readonly value: Finish; readonly onChange: (next: Finish) => void; readonly subjectLight?: boolean }) {
  const set = (patch: Partial<Finish>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Look</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Look">
          {LookSchema.options.map((look) => (
            <ToggleChip key={look} size="xs" selected={value.look === look} onClick={() => set({ look })}>
              {LOOK_LABEL[look]}
            </ToggleChip>
          ))}
        </div>
      </div>

      {subjectLight ? (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Subject light</span>
        <SlidingTabs
          tabs={[
            { id: "none", label: "None" },
            { id: "glow", label: "Glow" },
            { id: "outline", label: "Outline" },
          ]}
          value={value.subject}
          onValueChange={(id) => set({ subject: id as Finish["subject"] })}
        />
        {value.subject !== "none" ? (
          <>
            <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Light color">
              {AccentColorSchema.options.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  role="radio"
                  aria-checked={value.accent === accent}
                  aria-label={ACCENT_LABEL[accent]}
                  title={ACCENT_LABEL[accent]}
                  onClick={() => set({ accent })}
                  className={cn(
                    "size-6 rounded-full border border-border outline-offset-2 transition-[box-shadow,transform] duration-150 hover:scale-110",
                    value.accent === accent && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: `rgb(${ACCENT_RGB[accent].join(" ")})` }}
                />
              ))}
            </div>
            <Range label="Light strength" value={value.accentStrength} min={0.2} max={1} step={0.05} format={percent} onChange={(accentStrength) => set({ accentStrength })} />
          </>
        ) : null}
      </div>
      ) : null}

      <Range label="Vignette" value={value.vignette} min={0} max={1} step={0.05} format={(v) => (v ? percent(v) : "Off")} onChange={(vignette) => set({ vignette })} />
      <Range label="Film grain" value={value.grain} min={0} max={1} step={0.05} format={(v) => (v ? percent(v) : "Off")} onChange={(grain) => set({ grain })} />
      <span className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground" aria-hidden>Letterbox</span>
        <Switch checked={value.letterbox} onCheckedChange={(letterbox) => set({ letterbox })} label="Letterbox" />
      </span>
    </div>
  );
}

/** The few knobs each effect exposes. Every change re-renders from cached masks. */
export function EffectControls({
  family,
  value,
  onChange,
  duration = 30,
}: {
  readonly family: EffectId;
  readonly value: RenderParams;
  readonly onChange: (next: RenderParams) => void;
  /** Length of the video in seconds, for the titles' timing. */
  readonly duration?: number;
}) {
  const delivery = <DeliveryControls value={value.delivery} onChange={(next) => onChange({ ...value, delivery: next })} duration={duration} />;
  const choices = EFFECT_PLAN_EFFECTS[family];
  return (
    <div className="flex flex-col gap-4">
      {choices.length > 1 ? (
        <SlidingTabs
          tabs={choices.map((effect) => ({ id: effect, label: CHOICE_LABEL[effect] ?? effect }))}
          value={value.effect}
          onValueChange={(id) => onChange(defaultsFor(id as PlanEffect, value.finish, value.delivery))}
        />
      ) : null}

      {value.effect === "selective_color" ? (
        <Range label="Background desaturation" value={value.intensity} min={0.2} max={1} step={0.05} format={percent} onChange={(intensity) => onChange({ ...value, intensity })} />
      ) : null}

      {value.effect === "spotlight" ? (
        <Range label="Darkness" value={value.darkness} min={0.2} max={0.95} step={0.05} format={percent} onChange={(darkness) => onChange({ ...value, darkness })} />
      ) : null}

      {value.effect === "background_blur" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Blur</span>
          <SlidingTabs
            tabs={[
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium" },
              { id: "high", label: "High" },
            ]}
            value={value.level}
            onValueChange={(id) => onChange({ ...value, level: id as typeof value.level })}
          />
        </div>
      ) : null}

      {value.effect === "break_frame" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Frame</span>
            <SlidingTabs
              tabs={[
                { id: "compact", label: "Compact" },
                { id: "balanced", label: "Balanced" },
                { id: "wide", label: "Wide" },
              ]}
              value={value.frameSize}
              onValueChange={(id) => onChange({ ...value, frameSize: id as typeof value.frameSize })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Background</span>
            <div className="flex gap-1.5">
              <ToggleChip size="xs" selected={value.background === "dark"} onClick={() => onChange({ ...value, background: "dark" })}>
                Dark
              </ToggleChip>
              <ToggleChip size="xs" selected={value.background === "light"} onClick={() => onChange({ ...value, background: "light" })}>
                Light
              </ToggleChip>
            </div>
          </div>
        </>
      ) : null}

      {value.effect === "motion_echo" ? (
        <>
          <Range label="Trails" value={value.trailCount} min={2} max={6} step={1} format={(count) => String(count)} onChange={(trailCount) => onChange({ ...value, trailCount })} />
          <Range label="Spacing" value={value.trailSpacingMs} min={60} max={400} step={20} format={(ms) => `${ms} ms`} onChange={(trailSpacingMs) => onChange({ ...value, trailSpacingMs })} />
          <Range label="Intensity" value={value.intensity} min={0.2} max={1} step={0.05} format={percent} onChange={(intensity) => onChange({ ...value, intensity })} />
        </>
      ) : null}

      {value.effect === "erase" ? (
        <>
          <Range label="Cover margin" value={value.expand} min={0} max={24} step={1} format={(px) => `${px} px`} onChange={(expand) => onChange({ ...value, expand })} />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Fill from</span>
            <SlidingTabs
              tabs={[
                { id: "auto", label: "Other frames" },
                { id: "spatial", label: "Surroundings" },
              ]}
              value={value.fill}
              onValueChange={(id) => onChange({ ...value, fill: id as typeof value.fill })}
            />
          </div>
        </>
      ) : null}

      {value.effect === "pixelate" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Pixelate</span>
            <SlidingTabs
              tabs={[
                { id: "subject", label: "Subject" },
                { id: "background", label: "Background" },
              ]}
              value={value.region}
              onValueChange={(id) => onChange({ ...value, region: id as typeof value.region })}
            />
          </div>
          <Range label="Block size" value={value.blockSize} min={4} max={48} step={2} format={(px) => `${px} px`} onChange={(blockSize) => onChange({ ...value, blockSize })} />
        </>
      ) : null}

      {value.effect === "time_freeze_echo" && temporalEffectsEnabled() ? (
        <>
          <Range label="Echoes" value={value.echo.count} min={TEMPORAL_BOUNDS.echoCount[0]} max={TEMPORAL_BOUNDS.echoCount[1]} step={1} format={String} onChange={(count) => onChange({ ...value, echo: { ...value.echo, count } })} />
          <Range label="Echo spacing" value={value.echo.spacingMs} min={TEMPORAL_BOUNDS.echoSpacingMs[0]} max={TEMPORAL_BOUNDS.echoSpacingMs[1]} step={20} format={(ms) => `${ms} ms`} onChange={(spacingMs) => onChange({ ...value, echo: { ...value.echo, spacingMs } })} />
          <Range label="Echo intensity" value={value.echo.opacity} min={0} max={1} step={0.05} format={percent} onChange={(opacity) => onChange({ ...value, echo: { ...value.echo, opacity } })} />
          <Range label="Freeze duration" value={value.freezeDurationMs} min={TEMPORAL_BOUNDS.freezeDurationMs[0]} max={TEMPORAL_BOUNDS.freezeDurationMs[1]} step={100} format={(ms) => `${(ms / 1000).toFixed(1)} s`} onChange={(freezeDurationMs) => onChange({ ...value, freezeDurationMs })} />
        </>
      ) : null}

      {value.effect === "time_freeze_echo" ? (
        <Disclosure title="Finish and playback">
          <div className="mt-2 flex flex-col gap-4">
            <span className="flex items-center justify-between text-xs">
              <span aria-hidden className="text-muted-foreground">Resume playback</span>
              <Switch checked={value.resume} onCheckedChange={(resume) => onChange({ ...value, resume })} label="Resume playback" />
            </span>
            <Range label="Edge softness" value={value.feather} min={0} max={4} step={0.5} format={(px) => `${px} px`} onChange={(feather) => onChange({ ...value, feather })} />
            <FinishControls value={value.finish} onChange={(finish) => onChange({ ...value, finish })} />
            <div className="h-px bg-border" />
            {delivery}
          </div>
        </Disclosure>
      ) : (
        <>
          <Range label="Edge softness" value={value.feather} min={0} max={4} step={0.5} format={(px) => `${px} px`} onChange={(feather) => onChange({ ...value, feather })} />
          <div className="h-px bg-border" />
          <p className="-mb-1 text-xs font-medium text-foreground">Finish</p>
          <FinishControls value={value.finish} onChange={(finish) => onChange({ ...value, finish })} subjectLight={value.effect !== "erase" && !(value.effect === "pixelate" && value.region === "subject")} />
          <div className="h-px bg-border" />
          <p className="-mb-1 text-xs font-medium text-foreground">Format and titles</p>
          {delivery}
        </>
      )}
    </div>
  );
}
