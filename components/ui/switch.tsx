"use client";

import { useRef, useState, type CSSProperties } from "react";
import { cn } from "../../lib/utils";

/**
 * On/off switch.
 *
 * The thumb travel and the double bounce live in `.t-toggle` (globals.css);
 * this owns the box, the colours and the accessible wiring. `--toggle-travel`
 * is set here rather than read from the global default because the travel is
 * a function of this box: width - thumb - both paddings. `.is-init` is added
 * on the first flip, because the "off" keyframes would otherwise play on
 * mount and every switch on the page would twitch as it hydrated.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  /** Accessible name — the switch itself has no text. */
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const [interacted, setInteracted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-on={checked}
      onClick={() => {
        setInteracted(true);
        onCheckedChange(!checked);
      }}
      data-cuelume-toggle
      // 43 wide − 21 thumb − 3px padding either side = 16px of travel.
      style={{ "--toggle-travel": "16px" } as CSSProperties}
      className={cn(
        "t-toggle relative h-5 w-[43px] shrink-0 rounded-full p-0",
        "shadow-[var(--switch-track-shadow)]",
        "focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--switch-on)]",
        checked ? "bg-[var(--switch-on)]" : "bg-[var(--switch-off)]",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        interacted && "is-init",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Wider than it is tall, fully rounded: a stadium, not a circle.
          "t-toggle-thumb absolute top-[3px] left-[3px] h-3.5 w-[21px] rounded-full",
          "bg-[var(--switch-thumb)] shadow-[var(--switch-thumb-shadow)]",
        )}
      />
    </button>
  );
}
