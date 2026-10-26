import type { CSSProperties, ReactNode } from "react";

import { cn } from "../../lib/utils";

import styles from "./progress-meter.module.css";

export type ProgressMeterTone = "ok" | "low" | "critical";

/**
 * How much of something is left, as a thick glowing pill. `value` is a
 * percentage; the optional `label` sits inside the empty end of the track
 * (a date, days left) and stays legible where the fill reaches it.
 */
export function ProgressMeter({
  value,
  tone = "ok",
  label,
  className,
  "aria-label": ariaLabel,
  "aria-valuemin": ariaMin = 0,
  "aria-valuemax": ariaMax = 100,
  "aria-valuenow": ariaNow,
  "aria-valuetext": ariaText,
}: {
  readonly value: number;
  readonly tone?: ProgressMeterTone;
  readonly label?: ReactNode;
  readonly className?: string;
  readonly "aria-label": string;
  readonly "aria-valuemin"?: number;
  readonly "aria-valuemax"?: number;
  readonly "aria-valuenow"?: number;
  readonly "aria-valuetext"?: string;
}) {
  const percent = Math.min(100, Math.max(0, value));

  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={ariaMin}
      aria-valuemax={ariaMax}
      aria-valuenow={ariaNow ?? percent}
      aria-valuetext={ariaText}
      data-tone={tone}
      data-empty={percent === 0 ? "" : undefined}
      className={cn(styles.meter, className)}
      style={{ "--meter-value": `${percent}%` } as CSSProperties}
    >
      <div aria-hidden className={styles.glow} />
      <div aria-hidden className={styles.fill} />
      {label ? (
        <>
          <span aria-hidden className={styles.label}>
            {label}
          </span>
          <span aria-hidden className={cn(styles.label, styles.labelOnFill)}>
            {label}
          </span>
        </>
      ) : null}
    </div>
  );
}
