"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { Cancel01Icon, ArrowExpand01Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "../icons/icon";
import { cn } from "../../lib/utils";

export type LightboxMedia = {
  readonly kind: "image" | "video";
  readonly src: string;
  readonly alt: string;
  /** Shown under the picture. */
  readonly caption?: string;
  /** Sits the picture on the transparency checkerboard (sprites, cut-outs). */
  readonly transparent?: boolean;
  readonly poster?: string;
};

/**
 * A picture or a clip, large, over the page: the modal recipe (`.t-modal`,
 * `.t-scrim`). Escape, the scrim and the close button all dismiss it, and
 * focus returns to whatever opened it. With several `items` the arrow keys
 * walk them.
 */
export function MediaLightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  readonly items: readonly LightboxMedia[];
  /** The item shown; null keeps it closed. */
  readonly index: number | null;
  readonly onIndexChange?: (index: number) => void;
  readonly onClose: () => void;
}) {
  const open = index !== null && index >= 0 && index < items.length;
  // Hold the last item so the closing animation still has a picture to scale down.
  const last = React.useRef<LightboxMedia | null>(null);
  if (open) last.current = items[index!];
  const media = open ? items[index!] : last.current;
  const many = items.length > 1;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!many || !open || !onIndexChange) return;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    onIndexChange((index! + delta + items.length) % items.length);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="t-scrim fixed inset-0 z-50 bg-black/75 backdrop-blur-[3px]" />
        <Dialog.Content
          className="t-modal fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(94vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 outline-none"
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{media?.alt ?? "Preview"}</Dialog.Title>
          {media ? (
            <div
              className="relative grid min-h-0 place-items-center overflow-hidden rounded-2xl bg-black/40 shadow-2xl"
              data-transparent={media.transparent || undefined}
              style={media.transparent ? {
                backgroundColor: "var(--checker-base)",
                backgroundImage: "linear-gradient(45deg, #ffffff0a 25%, transparent 25%), linear-gradient(-45deg, #ffffff0a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ffffff0a 75%), linear-gradient(-45deg, transparent 75%, #ffffff0a 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
              } : undefined}
            >
              {media.kind === "video" ? (
                <video key={media.src} src={media.src} poster={media.poster} controls autoPlay loop playsInline className="block max-h-[80vh] w-auto max-w-full" aria-label={media.alt} />
              ) : (
                <img key={media.src} src={media.src} alt={media.alt} draggable={false} className="block max-h-[80vh] w-auto max-w-full object-contain" />
              )}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 px-1 text-xs text-white/70">
            <span className="min-w-0 truncate">{media?.caption ?? media?.alt}</span>
            {many && index !== null ? <span className="tabular-nums">{index + 1} / {items.length}</span> : null}
          </div>
          <Dialog.Close className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full bg-card text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-[color:var(--btn-focus-ring)]" aria-label="Close preview">
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.9} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Makes a small picture open large on click. The button is the picture's own
 * box (pass its layout in `className`) and shows an expand badge on hover and
 * keyboard focus.
 */
export function ZoomButton({
  label,
  onOpen,
  className,
  children,
  disabled,
  ...rest
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  readonly label: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("group/zoom relative cursor-zoom-in border-0 bg-transparent p-0 text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--btn-focus-ring)] disabled:cursor-default", className)}
      aria-label={label}
      onClick={onOpen}
      disabled={disabled}
      {...rest}
    >
      {children}
      {disabled ? null : (
        <span aria-hidden className="pointer-events-none absolute right-1.5 bottom-1.5 grid size-6 scale-90 place-items-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur-sm transition-[opacity,scale] duration-150 ease-[var(--ease-smooth-out)] group-hover/zoom:scale-100 group-hover/zoom:opacity-100 group-focus-visible/zoom:scale-100 group-focus-visible/zoom:opacity-100 motion-reduce:transition-none">
          <HugeiconsIcon icon={ArrowExpand01Icon} size={12} strokeWidth={1.9} />
        </span>
      )}
    </button>
  );
}
