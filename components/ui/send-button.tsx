"use client";

import type { ComponentProps } from "react";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../icons/icon";
import { Button } from "./button";
import { Spinner } from "./spinner";
import { cn } from "../../lib/utils";

/**
 * The send control every composer ends in: the main chat, the agent's
 * assistant and the automation's. Each had its own copy — 32px and round in
 * the docks, 36px and square-cornered in the chat, a beam in some — so the
 * same action looked like three buttons.
 *
 * It is the `chat` Button: black in light, white in dark, on the composer's 16px
 * corner, shared with the attach, tools and mic buttons beside it.
 */
export function SendButton({
  busy = false,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  /** A request in flight: the arrow becomes a spinner of the same size. */
  readonly busy?: boolean;
}) {
  return (
    <Button
      variant="chat"
      size="icon"
      className={cn("size-7 shrink-0 rounded-xl p-0 md:size-9", className)}
      {...props}
    >
      {children ?? (busy ? <Spinner size={15} strokeWidth={2} /> : <HugeiconsIcon icon={ArrowUp01Icon} size={16} strokeWidth={2.5} />)}
    </Button>
  );
}
