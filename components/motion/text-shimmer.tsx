import { cn } from "../../lib/utils";
import type { ReactNode } from "react";
import {
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from "../../lib/text-shimmer";

/**
 * Text-level wrappers only, rather than `ElementType`.
 *
 * A prop typed as "any element" has to satisfy every element's props at
 * once, so any dependency that augments the global JSX table (as
 * `@react-three/fiber` did while the voice orb used it) collapses `children`
 * and `className` to `never` here. The narrow list is also closer to the
 * truth: this renders text, and every call site passes h1, h2 or span.
 */
type TextTag =
  | "span"
  | "div"
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "label"
  | "strong"
  | "em";

export interface TextShimmerProps {
  children: ReactNode;
  as?: TextTag;
  duration?: number;
  className?: string;
}

export function TextShimmer({ children, as: Comp = "span", duration = 2.5, className }: TextShimmerProps) {
  return (
    <>
      <style>
        {TEXT_SHIMMER_KEYFRAMES}
      </style>
      <Comp
        style={textShimmerStyle(duration)}
        className={cn(
          "inline-block",
          TEXT_SHIMMER_CLASS_NAME,
          className,
        )}
      >
        {children}
      </Comp>
    </>
  );
}
