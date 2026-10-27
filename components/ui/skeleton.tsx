import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";
import styles from "./skeleton.module.css";

/**
 * A shaped placeholder. Size it with className or style; `shape` rounds it
 * into a pill or a line of text. `delay` offsets the sheen (ms) so a row of
 * skeletons shimmers left to right. Always decorative: the region that owns
 * it says it is loading.
 */
function Skeleton({
  className,
  style,
  shape = "block",
  delay,
}: {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly shape?: "block" | "round" | "text";
  readonly delay?: number;
}) {
  return (
    <span
      aria-hidden
      className={cn(styles.skeleton, shape === "round" && styles.round, shape === "text" && styles.text, className)}
      style={delay ? ({ ...style, "--skeleton-delay": `${delay}ms` } as CSSProperties) : style}
    />
  );
}

export { Skeleton };
