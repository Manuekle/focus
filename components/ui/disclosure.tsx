"use client";

import * as React from "react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "../icons/icon";
import { cn } from "../../lib/utils";

/**
 * A header with a body that grows and shrinks in height: the accordion
 * recipe (`.t-acc`, styles/recipes.css). The chevron is an icon that flips
 * from "v" to "^"; the panel animates via grid rows, so content of any size
 * eases open without measuring. Replaces the native `<details>`, whose
 * triangle is a text glyph that cannot animate.
 */
export function Disclosure({
  title,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  className,
  children,
}: {
  readonly title: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const open = controlled ?? inner;
  const panelId = React.useId();
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return (
    <div className={cn("t-acc", className)} data-open={open}>
      <button
        type="button"
        // `.t-acc-head` resets font and color to inherit and is unlayered, so the type lives on the spans.
        className="t-acc-head group/disclosure flex w-full items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--btn-focus-ring)]"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="text-xs font-medium text-muted-foreground transition-colors duration-150 group-hover/disclosure:text-foreground group-focus-visible/disclosure:text-foreground">{title}</span>
        <span className="t-acc-chevron text-muted-foreground" aria-hidden>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.75} />
        </span>
      </button>
      <div id={panelId} className="t-acc-panel" role="region" inert={!open}>
        <div className="t-acc-panel-inner">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
