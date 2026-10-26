import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../../lib/utils";
import styles from "./category-badge.module.css";

/** Category identity, separate from success/warning/error status colors.
 *  Same `.pill` geometry as StatusBadge, so a channel pill and a status pill
 *  in one row line up; `sm` is for dense chip rows inside cards. */
export function CategoryBadge({
  hue,
  size = "default",
  className,
  style,
  ...props
}: ComponentProps<"span"> & { readonly hue?: number; readonly size?: "default" | "sm" }) {
  return (
    <span
      {...props}
      data-slot="category-badge"
      className={cn("pill w-fit", size === "sm" && "pill-sm", styles.badge, className)}
      style={{ "--category-hue": hue, ...style } as CSSProperties}
    />
  );
}
