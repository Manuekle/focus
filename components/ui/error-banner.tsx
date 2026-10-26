"use client";

// The one way a page says "that didn't work".
//
// Pages had grown three different banners — a bare red line, a bordered box, a
// Card — for the same job. The message inside is always already localized:
// `lib/api-error-message.ts` is what produces it, so nothing here ever renders
// a status code or a server sentence.

import { useEffect, useRef, useState } from "react";
import { Rise } from "cube-motion/react";
import { HugeiconsIcon } from "../icons/icon";
import { ArrowReloadHorizontalIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useSound } from "../sound-provider";
import { AlertIconChip } from "./alert";
import { useT } from "../../lib/i18n/provider";
import { isApiError, uiErrorMessage, type UiError } from "../../lib/api-error-message";
import { cn } from "../../lib/utils";

export function ErrorBanner({
  error,
  messageKey,
  message,
  /** Technical context (the provider's own words, a stack message). Shown
   *  smaller, under the sentence — useful in a support thread, never the
   *  headline. */
  detail,
  onRetry,
  onDismiss,
  layout = "card",
  className,
}: {
  /** What went wrong — a failed request, or a dictionary key for a local
   *  failure. Translated here rather than stored as a finished sentence, so
   *  switching language re-renders the banner in the new one. */
  readonly error?: UiError | null;
  /** Shorthand for `error={{ messageKey }}`. */
  readonly messageKey?: string | null;
  /** An already-final sentence. Last resort — it will not re-translate. */
  readonly message?: string | null;
  readonly detail?: string;
  /** Shown as an icon button in the corner, before the close button. */
  readonly onRetry?: () => void;
  /** The close button. */
  readonly onDismiss?: () => void;
  /**
   * `strip` is the page-level notice: flat, full width, the last row of the
   * page header (`PageContainer`'s `banner`), the way /calendar has always
   * drawn it. `card` floats inside a dialog, drawer or panel.
   */
  readonly layout?: "card" | "strip";
  readonly className?: string;
}) {
  const t = useT();
  const { cue } = useSound();

  const text = error
    ? uiErrorMessage(t, error)
    : messageKey
      ? t(messageKey)
      : message;
  const context = detail ?? (error && isApiError(error) ? error.detail : undefined);

  // Sound the banner when it *appears*, not when it is merely on screen.
  //
  // A banner already rendered on the first pass is a load that failed before
  // anyone touched anything — a background event, and cuelume's own guidance
  // is to keep those quiet. One that shows up later is the response to
  // something the user just did, which is exactly what `error` is for.
  // Keyed on the previous message, not on a "have I mounted" flag: an effect
  // that re-runs without the banner changing — StrictMode's double invoke in
  // dev, a new `cue` identity — must not sound a second time for the same
  // failure.
  //
  // The previous value is boxed because `text` is itself usually `undefined`
  // before anything fails: a bare `undefined` sentinel could not tell "no
  // banner yet" from "first pass already ran", and the error that followed
  // would be the one that stayed silent.
  const seen = useRef<{ readonly value: typeof text } | null>(null);
  useEffect(() => {
    const previous = seen.current;
    if (text && previous && previous.value !== text) cue("error");
    seen.current = { value: text };
  }, [text, cue]);

  // The last message, kept while the banner leaves: `show` runs the exit
  // first and unmounts after, but the render that flips it already has no
  // text — without this the fade-out would play over an emptied banner.
  // State adjusted during render (compare, then set): the sanctioned
  // previous-value pattern, no effect and no extra commit needed.
  const [retained, setRetained] = useState<{
    readonly text: string;
    readonly context: string | undefined;
  } | null>(null);
  if (text && (retained?.text !== text || retained?.context !== context)) {
    setRetained({ text, context });
  }
  const shown = text ? { text, context } : retained;

  // Drawn as the error `Alert` — same surface, chip and close — but kept its
  // own component for what Alert does not do: translate a `UiError`, cue the
  // sound on arrival, and keep the last message while the exit plays.
  return (
    <Rise
      show={Boolean(text)}
      role="status"
      aria-live="polite"
      data-tone="error"
      className={cn(
        "alert-surface flex items-start gap-3",
        layout === "strip"
          ? "rounded-none border-t px-3 py-3 sm:px-4"
          : "rounded-2xl border p-4 shadow-[var(--shadow-elevated),var(--shadow-inset)]",
        className,
      )}
    >
      <AlertIconChip tone="error" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 text-foreground">{shown?.text}</p>
        {/* The raw cause is for whoever fixes it, not for the owner reading
            the banner: folded away, one click from support's copy-paste. */}
        {shown?.context ? (
          <details className="mt-1 text-xs leading-4 text-muted-foreground">
            <summary className="w-fit cursor-pointer list-none transition-colors select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              {t("apiError.showDetail")}
            </summary>
            <p className="mt-1 break-words">{shown.context}</p>
          </details>
        ) : null}
      </div>
      {/* Retry first, then close. A failure that can be retried is answered
          by retrying; a page that also offers to hide it keeps the X, so the
          banner never becomes something the owner cannot get rid of. */}
      {onRetry || onDismiss ? (
        <div className="-my-1 -mr-1 flex shrink-0 items-center gap-0.5">
          {/* Said in words: an icon-only retry used the loading glyph, and a
              spinner in the corner of an error read as "still trying". */}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={13} strokeWidth={1.75} />
              {t("apiError.retry")}
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t("apiError.dismiss")}
              className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      ) : null}
    </Rise>
  );
}
