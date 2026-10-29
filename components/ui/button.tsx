import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "../../lib/utils";
import styles from "./button.module.css";

const buttonVariants = cva(
  cn(
    styles.button,
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 text-xs leading-[18px] font-medium tracking-[-0.02em] whitespace-nowrap md:text-sm",
    "transition-[background-color,box-shadow,scale,border-color,color,opacity] duration-150 ease-[var(--btn-easing)] motion-reduce:transition-none",
    // Outlines preserve the surface shadows and remain visible in forced colors.
    // A 1px gap: close enough to read as part of the control, not a halo.
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--btn-focus-ring)]",
    "forced-colors:border forced-colors:border-[ButtonText] forced-colors:focus-visible:outline-[color:Highlight]",
    "disabled:pointer-events-none disabled:cursor-default disabled:opacity-[0.42] disabled:shadow-none aria-busy:opacity-75",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        default: cn(
          styles.highlight, styles.primary,
          "text-[var(--btn-primary-fg)] bg-[var(--btn-primary-bg)] shadow-[var(--btn-primary-shadow)]",
          "hover:bg-[var(--btn-primary-bg-hover)] active:shadow-[var(--btn-primary-shadow-pressed)]",
        ),
        ai: cn(
          styles.highlight, styles.ai,
          "text-[var(--btn-ai-fg)] bg-[var(--btn-ai-bg)] shadow-[var(--btn-ai-shadow)]",
          "hover:bg-[var(--btn-ai-bg-hover)] active:shadow-[var(--btn-ai-shadow-pressed)]",
        ),
        chat: cn(
          styles.highlight, styles.chat,
          "text-[var(--btn-chat-fg)] bg-[var(--btn-chat-bg)] shadow-[var(--btn-chat-shadow)]",
          "hover:bg-[var(--btn-chat-bg-hover)] active:shadow-[var(--btn-chat-shadow-pressed)]",
        ),
        destructive: cn(
          styles.highlight, styles.destructive,
          "text-[var(--btn-destructive-fg)] bg-[var(--btn-destructive-bg)] shadow-[var(--btn-destructive-shadow)]",
          "hover:shadow-[var(--btn-destructive-shadow-hover)] hover:bg-[var(--btn-destructive-bg-hover)]",
          "active:shadow-[var(--btn-destructive-shadow-pressed)] focus-visible:outline-[color:var(--btn-destructive-focus-ring)]",
        ),
        secondary: cn(
          styles.highlight, styles.secondary,
          "text-[var(--btn-secondary-fg)] bg-[var(--btn-secondary-bg)] shadow-[var(--btn-secondary-shadow)]",
          "hover:bg-[var(--btn-secondary-bg-hover)] active:shadow-[var(--btn-secondary-shadow-pressed)]",
        ),
        outline: cn(
          styles.highlight, styles.outline,
          "text-[var(--btn-outline-fg)] bg-[var(--btn-outline-bg)] shadow-[var(--btn-outline-shadow)]",
          "hover:bg-[var(--btn-outline-bg-hover)] active:shadow-[var(--btn-outline-shadow-pressed)]",
        ),
        neutral: cn(
          styles.highlight, styles.outline,
          "text-[var(--btn-outline-fg)] bg-[var(--btn-outline-bg)] shadow-[var(--btn-outline-shadow)]",
          "hover:bg-[var(--btn-outline-bg-hover)] active:shadow-[var(--btn-outline-shadow-pressed)]",
        ),
        ghost:
          "bg-transparent hover:bg-[var(--btn-ghost-hover-bg)]",
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Focus comfort density: xs 28, sm 32, default 36 and lg 40px.
        // Same `rounded-lg` as Input/Select so a button beside a field matches;
        // only the xs sizes step down, where 12px would read as a pill.
        default: "h-9 px-4 has-[>svg]:px-3",
        xs: "h-7 gap-1 rounded-md px-2 text-xs leading-4 md:text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-2.5 text-xs leading-4 md:text-[13px] has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-5 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

/**
 * Which variants carry a full `tap`.
 *
 * Only the variants that mean "do the thing" are tagged. The rest — the close
 * X, the toolbar icon, the inline "see more" — fall to the provider's floor,
 * which plays the same tap at `subtle`: every control answers, but a stray
 * click on chrome never sounds like a commitment.
 */
const TAPS: Partial<Record<ButtonVariant, true>> = {
  default: true,
  ai: true,
  chat: true,
  destructive: true,
};

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  // A Button that opens a menu or popover is a disclosure, not a commit: left
  // untagged, the floor reads its `aria-expanded` and plays open/close. And a
  // call site that names its own cue (`data-cuelume-close` on a Stop) gets
  // only that one — `bind()` picks the first attribute it finds, and `tap`
  // would win.
  const taps =
    variant !== null &&
    TAPS[variant] === true &&
    props["aria-expanded"] === undefined &&
    props["aria-haspopup"] === undefined &&
    !Object.keys(props).some((key) => key.startsWith("data-cuelume-"));

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      {...(taps ? { "data-cuelume-tap": "" } : {})}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
