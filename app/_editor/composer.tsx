"use client";

import { useId } from "react";
import { MagicWand01Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { Textarea } from "../../components/ui/textarea";
import { HugeiconsIcon } from "../../components/icons/icon";
import { cn } from "../../lib/utils";
import { EFFECTS } from "../../shared/pipeline";
import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH, type EffectId } from "../../shared/schemas";

export function Composer({
  effect,
  onEffectChange,
  prompt,
  onPromptChange,
  onSubmit,
  disabled,
  busy,
}: {
  readonly effect: EffectId;
  readonly onEffectChange: (effect: EffectId) => void;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
  readonly busy: boolean;
}) {
  const promptId = useId();
  const hintId = useId();
  const selected = EFFECTS.find((entry) => entry.id === effect) ?? EFFECTS[0];
  const ready = prompt.trim().length >= PROMPT_MIN_LENGTH;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && ready && !busy) onSubmit();
      }}
    >
      <fieldset disabled={disabled} className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Efecto</legend>
        {EFFECTS.map((entry) => {
          const active = entry.id === effect;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => onEffectChange(entry.id)}
              className={cn(
                "rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color] duration-150",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
                active
                  ? "border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] bg-accent"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className={cn("block text-sm font-medium", active ? "text-accent-foreground" : "text-foreground")}>
                {entry.name}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{entry.summary}</span>
            </button>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={promptId} className="text-xs font-medium text-muted-foreground">
          Describe el cambio
        </label>
        <Textarea
          id={promptId}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          disabled={disabled}
          maxLength={PROMPT_MAX_LENGTH}
          rows={3}
          aria-describedby={hintId}
          placeholder={disabled ? "Sube un video para empezar" : selected.example}
          className="min-h-24"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
          }}
        />
        <div id={hintId} className="flex items-center justify-between gap-3">
          {!disabled && !prompt ? (
            <SuggestionChip size="xs" onClick={() => onPromptChange(selected.example)}>
              Usar ejemplo
            </SuggestionChip>
          ) : (
            <span className="text-xs text-muted-foreground">Nombra el sujeto con claridad.</span>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">
            {prompt.length}/{PROMPT_MAX_LENGTH}
          </span>
        </div>
      </div>

      <Button type="submit" variant="ai" size="lg" disabled={disabled || !ready || busy} aria-busy={busy}>
        {busy ? <Spinner /> : <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={1.75} />}
        Generar edición
      </Button>
    </form>
  );
}
