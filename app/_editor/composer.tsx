"use client";

import { useId } from "react";
import { MagicWand01Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { Textarea } from "../../components/ui/textarea";
import { HugeiconsIcon } from "../../components/icons/icon";
import { EFFECTS } from "../../shared/pipeline";
import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH, type EffectId } from "../../shared/schemas";

/**
 * Effect + instruction. The text can be written before a video exists; only
 * the submit waits for one (`canSubmit`).
 */
export function Composer({
  effect,
  onEffectChange,
  prompt,
  onPromptChange,
  onSubmit,
  canSubmit,
  blockedReason,
  busy,
}: {
  readonly effect: EffectId;
  readonly onEffectChange: (effect: EffectId) => void;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly onSubmit: () => void;
  readonly canSubmit: boolean;
  /** Shown under the button when it cannot submit for a reason other than the text. */
  readonly blockedReason?: string;
  readonly busy: boolean;
}) {
  const promptId = useId();
  const hintId = useId();
  const selected = EFFECTS.find((entry) => entry.id === effect) ?? EFFECTS[0];
  const ready = prompt.trim().length >= PROMPT_MIN_LENGTH;
  const submittable = canSubmit && ready && !busy;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onSubmit();
      }}
    >
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Efecto</legend>
        <SlidingTabs
          className="flex w-full [&>.t-tab]:flex-1 [&>.t-tab]:px-2"
          tabs={EFFECTS.map((entry) => ({ id: entry.id, label: entry.name }))}
          value={effect}
          onValueChange={(id) => onEffectChange(id as EffectId)}
        />
        <p className="min-h-10 text-xs leading-5 text-muted-foreground" aria-live="polite">
          {selected.summary}
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={promptId} className="text-xs font-medium text-muted-foreground">
          Describe el cambio
        </label>
        <Textarea
          id={promptId}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          maxLength={PROMPT_MAX_LENGTH}
          rows={3}
          aria-describedby={hintId}
          placeholder="¿Qué quieres cambiar?"
          className="min-h-24"
          onKeyDown={(event) => {
            // Enter submits; Shift+Enter is a new line; never while an IME is composing.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div id={hintId} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Enter para generar · Shift+Enter, nueva línea</span>
          <span className="tabular-nums">
            {prompt.length}/{PROMPT_MAX_LENGTH}
          </span>
        </div>
        {!prompt ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Ejemplos">
            {selected.examples.map((example) => (
              <SuggestionChip key={example} size="xs" onClick={() => onPromptChange(example)}>
                {example}
              </SuggestionChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Button type="submit" variant="ai" size="lg" disabled={!submittable} aria-busy={busy} aria-describedby={blockedReason ? `${hintId}-blocked` : undefined}>
          {busy ? <Spinner /> : <HugeiconsIcon icon={MagicWand01Icon} size={16} strokeWidth={1.75} />}
          Generar
        </Button>
        {blockedReason ? (
          <p id={`${hintId}-blocked`} className="text-center text-xs text-muted-foreground">
            {blockedReason}
          </p>
        ) : null}
      </div>
    </form>
  );
}
