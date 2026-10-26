"use client";

import { useId } from "react";
import { AiVideo01Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { Textarea } from "../../components/ui/textarea";
import { HugeiconsIcon } from "../../components/icons/icon";
import { EFFECTS } from "../../shared/pipeline";
import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH, type EffectId } from "../../shared/schemas";
import styles from "./composer.module.css";

/**
 * The creative step, revealed once a clip is ready.
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
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onSubmit();
      }}
    >
      <fieldset className={styles.effects}>
        <legend className="sr-only">Choose an effect</legend>
        <SlidingTabs
          className={styles.tabs}
          tabs={EFFECTS.map((entry) => ({ id: entry.id, label: entry.name }))}
          value={effect}
          onValueChange={(id) => onEffectChange(id as EffectId)}
        />
        <p className={styles.summary} aria-live="polite">
          {selected.summary}
        </p>
      </fieldset>

      <div className={styles.instruction}>
        <label htmlFor={promptId} className={styles.label}>
          Describe the change
        </label>
        <Textarea
          id={promptId}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          maxLength={PROMPT_MAX_LENGTH}
          rows={3}
          aria-describedby={hintId}
          placeholder="A little blur. A bold entrance. What’s your idea?"
          className={styles.textarea}
          onKeyDown={(event) => {
            // Enter submits; Shift+Enter is a new line; never while an IME is composing.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div id={hintId} className={styles.hint}>
          <span>Enter to generate · Shift+Enter for a new line</span>
          <span className="tabular-nums">
            {prompt.length}/{PROMPT_MAX_LENGTH}
          </span>
        </div>
        {!prompt ? (
          <div className={styles.examples} aria-label="Try an idea">
            <span>Try:</span>
            {selected.examples.map((example) => (
              <SuggestionChip size="xs" key={example} onClick={() => onPromptChange(example)}>{example}</SuggestionChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.submit}>
        <Button className={styles.generate} type="submit" variant="ai" size="lg" disabled={!submittable} aria-busy={busy} aria-describedby={blockedReason ? `${hintId}-blocked` : undefined}>
          {busy ? <Spinner /> : <HugeiconsIcon icon={AiVideo01Icon} size={16} strokeWidth={1.75} />}
          Generate edit
        </Button>
        {blockedReason ? (
          <p id={`${hintId}-blocked`} className={styles.blocked}>
            {blockedReason}
          </p>
        ) : null}
      </div>
    </form>
  );
}
