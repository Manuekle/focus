"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import styles from "./otp-input.module.css";

/**
 * A one-time numeric code, one slot per digit.
 *
 * One real input sits transparently over the slots, so typing, paste and
 * autofill (SMS, 1Password, iOS) all arrive as a single value. The code is
 * handed over the moment its last digit lands: `onComplete` is the submit, so
 * there is no button to find. `errorKey` replays the shake when a new wrong
 * code arrives while `invalid` is still set from the last one.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  busy = false,
  invalid = false,
  errorKey = 0,
  autoFocus = false,
  label,
  id,
  className,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onComplete?: (value: string) => void;
  readonly length?: number;
  readonly disabled?: boolean;
  /** The code is being checked: the slots pulse and the input is locked. */
  readonly busy?: boolean;
  readonly invalid?: boolean;
  readonly errorKey?: number;
  readonly autoFocus?: boolean;
  readonly label: string;
  readonly id?: string;
  readonly className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wasFocused = useRef(false);
  // A locked input drops focus; hand it back when the check ends so the next
  // attempt is typed straight away.
  useEffect(() => {
    if (!busy && wasFocused.current) input.current?.focus();
  }, [busy]);
  const activeIndex = Math.min(value.length, length - 1);
  const split = length % 2 === 0 ? length / 2 : -1;

  const update = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length && digits !== value) onComplete?.(digits);
  };

  return (
    <div className={cn("relative mx-auto w-fit", className)}>
      <div key={errorKey} className={cn("flex items-center gap-1.5 sm:gap-2", invalid && errorKey > 0 && styles.shake, busy && styles.busy)}>
        {Array.from({ length }, (_, index) => {
          const digit = value[index];
          const active = focused && !disabled && index === activeIndex;
          return (
            <div key={index} className="flex items-center">
              {index === split ? <span aria-hidden="true" className="mr-2 h-px w-2 bg-border" /> : null}
              <div
                aria-hidden="true"
                style={{ "--i": index } as React.CSSProperties}
                className={cn(
                  styles.slot,
                  "flex h-12 w-8 items-center justify-center rounded-xl border border-input bg-muted font-numeral text-xl font-medium tabular-nums shadow-[var(--shadow-inset)] min-[400px]:w-10 sm:h-14 sm:w-12 sm:text-2xl",
                  active && styles.active,
                  invalid && styles.invalid,
                  disabled && !busy && "opacity-50",
                )}
              >
                {digit ? (
                  <span key={`${index}-${digit}`} className={styles.digit}>
                    {digit}
                  </span>
                ) : active ? (
                  <span className={styles.caret} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <input
        id={id}
        ref={input}
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        className="absolute inset-0 size-full cursor-text bg-transparent text-transparent opacity-0 caret-transparent outline-none"
        disabled={disabled || busy}
        inputMode="numeric"
        maxLength={length}
        onBlur={() => setFocused(false)}
        onChange={(event) => update(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          wasFocused.current = true;
          // The caret always sits after the last digit: no editing in the middle.
          const end = event.target.value.length;
          event.target.setSelectionRange(end, end);
        }}
        onSelect={(event) => {
          const end = event.currentTarget.value.length;
          if (event.currentTarget.selectionStart !== end) event.currentTarget.setSelectionRange(end, end);
        }}
        pattern="[0-9]*"
        value={value}
      />
    </div>
  );
}
