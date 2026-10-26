import styles from "./editorial.module.css";

/** A cached, static texture. Kept behind content and local to each surface. */
export function Grain({
  variant = "surface",
}: {
  readonly variant?: "hero" | "surface" | "closing";
}) {
  return <span aria-hidden="true" className={styles.grain} data-grain={variant} />;
}
