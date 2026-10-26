"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./figma-buttons.module.css";

type FigmaButtonProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  variant?: NonNullable<ComponentProps<typeof Button>["variant"]> | "accent";
  static?: boolean;
  previewState?: "hover" | "pressed" | "focus";
};

/** Fixed reference skin for comparing the approved Figma with the app Button. */
export function FigmaButton({
  variant = "default",
  size = "default",
  type = "button",
  static: isStatic = false,
  previewState,
  className,
  ...props
}: FigmaButtonProps) {
  return (
    <Button
      {...props}
      type={type}
      variant={variant === "accent" ? "ai" : variant}
      size={size}
      data-figma-variant={variant}
      data-preview-state={previewState}
      data-static={isStatic || undefined}
      className={cn(styles.button, className)}
    />
  );
}
