"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AiVideo01Icon, AiSearch02Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { HugeiconsIcon } from "../../components/icons/icon";
import { cn } from "../../lib/utils";
import { availableEffects } from "../../shared/pipeline";
import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH, type EffectId, type Suggestions } from "../../shared/schemas";
import { completionCandidates, completionFor } from "./autocomplete";
import styles from "./composer.module.css";

/**
 * The creative step, revealed once a clip is ready. Ideas come from the clip
 * itself when Muse Spark has looked at it; Tab accepts the inline completion.
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
  suggestions = null,
  suggestionsLoading = false,
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
  readonly suggestions?: Suggestions | null;
  readonly suggestionsLoading?: boolean;
}) {
  const promptId = useId();
  const hintId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const effects = availableEffects();
  const selected = effects.find((entry) => entry.id === effect) ?? effects[0];
  const ready = prompt.trim().length >= PROMPT_MIN_LENGTH;
  const submittable = canSubmit && ready && !busy;

  const subjects = suggestions?.subjects ?? [];
  const candidates = useMemo(() => completionCandidates(effect, suggestions), [effect, suggestions]);
  const ideas = suggestions?.ideas[effect].length ? suggestions.ideas[effect] : selected.examples;
  const fromClip = Boolean(suggestions?.ideas[effect].length);
  const completion = caretAtEnd && dismissed !== prompt ? completionFor(prompt, candidates, subjects) : null;
  const ghost = completion && prompt.length + completion.length <= PROMPT_MAX_LENGTH ? completion : null;

  const accept = () => {
    if (!ghost) return;
    onPromptChange(prompt + ghost);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (element) element.selectionStart = element.selectionEnd = element.value.length;
    });
  };

  const insertSubject = (subject: string) => {
    const base = prompt.trimEnd();
    const next = base ? `${base} ${/\bthe$/i.test(base) ? "" : "the "}${subject}` : `Keep the ${subject} in focus`;
    onPromptChange(next.replace(/\s+/g, " ").slice(0, PROMPT_MAX_LENGTH));
    textareaRef.current?.focus();
  };

  const trackCaret = (element: HTMLTextAreaElement) => setCaretAtEnd(element.selectionStart === element.value.length && element.selectionEnd === element.value.length);

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
          tabs={effects.map((entry) => ({ id: entry.id, label: entry.name }))}
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
        <div className={styles.field} data-filled={prompt ? "" : undefined}>
          <div className={styles.input}>
            {/* The typed text, invisible, then the completion: it wraps exactly like the textarea. */}
            <div aria-hidden className={styles.ghost}>
              <span className={styles.ghostTyped}>{prompt}</span>
              {ghost ? <span className={styles.ghostRest}>{ghost}</span> : null}
            </div>
            <textarea
              ref={textareaRef}
              id={promptId}
              value={prompt}
              onChange={(event) => {
                onPromptChange(event.target.value);
                trackCaret(event.target);
              }}
              onSelect={(event) => trackCaret(event.currentTarget)}
              maxLength={PROMPT_MAX_LENGTH}
              rows={3}
              aria-describedby={hintId}
              aria-autocomplete="inline"
              placeholder={subjects.length ? `Try “Keep the ${subjects[0].replace(/^(the|a|an)\s+/i, "")} in focus”` : "A little blur. A bold entrance. What’s your idea?"}
              className={styles.textarea}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (ghost && (event.key === "Tab" || (event.key === "ArrowRight" && caretAtEnd)) && !event.shiftKey) {
                  event.preventDefault();
                  accept();
                  return;
                }
                if (ghost && event.key === "Escape") {
                  event.preventDefault();
                  setDismissed(prompt);
                  return;
                }
                // Enter submits; Shift+Enter is a new line.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          <div id={hintId} className={styles.hint}>
            {ghost ? (
              <span className={styles.hintAction}>
                <kbd>Tab</kbd> to complete · <kbd>Esc</kbd> to dismiss
              </span>
            ) : (
              <span className={styles.hintKeys}>
                <kbd>Enter</kbd> to generate · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
              </span>
            )}
            <span className="tabular-nums">
              {prompt.length}/{PROMPT_MAX_LENGTH}
            </span>
          </div>
        </div>

      </div>

      {/* Ideas replace the prompt; subjects add to it. Label above, so the chips line up. */}
      <div className={styles.ideas}>
        <div className={styles.group} role="group" aria-label="Ideas for this clip">
          <span className={styles.groupLabel}>
            {suggestionsLoading ? <Spinner className="size-3" /> : <HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />}
            {suggestionsLoading ? "Reading your clip…" : fromClip ? "Ideas for this clip" : "Try"}
          </span>
          <div className={styles.chips}>
            {suggestionsLoading
              ? [0, 1].map((index) => <span key={index} aria-hidden className={cn(styles.skeleton, index && styles.skeletonShort)} />)
              : ideas.map((idea) => (
                  <SuggestionChip size="xs" key={idea} onClick={() => onPromptChange(idea)} className={styles.chip}>
                    {idea}
                  </SuggestionChip>
                ))}
          </div>
        </div>
        {subjects.length ? (
          <div className={styles.group} role="group" aria-label="Subjects in this clip">
            <span className={styles.groupLabel}>In view · tap to add</span>
            <div className={styles.chips}>
              {subjects.map((subject) => (
                <button key={subject} type="button" className={styles.subject} onClick={() => insertSubject(subject.replace(/^(the|a|an)\s+/i, ""))}>
                  <span aria-hidden className={styles.subjectPlus}>+</span>
                  {subject}
                </button>
              ))}
            </div>
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
