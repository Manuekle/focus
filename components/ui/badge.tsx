import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

const tones = {
  neutral: "tone-expired",
  info: "tone-progress",
  success: "tone-success",
  warning: "tone-pending",
  danger: "tone-failed",
} as const;

/** The system's existing pill geometry and semantic theme colours. */
export function Badge({
  tone = "neutral",
  size = "default",
  className,
  ...props
}: ComponentProps<"span"> & {
  readonly tone?: keyof typeof tones;
  readonly size?: "default" | "sm";
}) {
  return (
    <span
      data-slot="badge"
      className={cn("pill tone-pill tabular-nums", tones[tone], size === "sm" && "pill-sm", className)}
      {...props}
    />
  );
}
