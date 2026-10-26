"use client";

import { useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { CursorInfo01Icon, VideoOffIcon } from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The walkthrough video for one credential card: where the key lives in the
 * vendor's console, and where it goes here.
 *
 * The files are plain statics under `public/videos/tutorials/`, named after
 * the card's own id — see the README there. That is the whole registry: a
 * new tutorial ships by dropping `<id>.mp4` in the folder, no code change.
 * Until the file exists the modal says so rather than showing a dead player,
 * which is what makes it safe to wire every card up before a single video is
 * recorded.
 */
export function tutorialVideoSrc(id: string): string {
  return `/videos/tutorials/${id}.mp4`;
}

/** First frame, so the modal isn't a black rectangle before you hit play.
 *  Optional: a missing poster fails silently, unlike a missing source. */
export function tutorialPosterSrc(id: string): string {
  return `/videos/tutorials/${id}.jpg`;
}

/** The player, plus the "not recorded yet" state it falls back to.
 *
 *  Lives in its own component so its status resets every time the modal
 *  opens — Radix unmounts the content on close, and a video that 404'd this
 *  morning may well be there this afternoon. */
function TutorialPlayer({ id }: { readonly id: string }) {
  const t = useT();
  const [missing, setMissing] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted/40">
      {missing ? (
        <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
            <HugeiconsIcon icon={VideoOffIcon} size={22} strokeWidth={1.75} />
          </div>
          <p className="text-sm font-medium">{t("settings.tutorial.soonTitle")}</p>
          <p className="max-w-[48ch] text-xs leading-relaxed text-muted-foreground">
            {t("settings.tutorial.soonBody")}
          </p>
        </div>
      ) : (
        <video
          className="size-full bg-black object-contain"
          controls
          controlsList="nodownload"
          playsInline
          preload="metadata"
          poster={tutorialPosterSrc(id)}
          src={tutorialVideoSrc(id)}
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}

export function TutorialVideoDialog({
  id,
  name,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  /** The card's id — also the video's filename. */
  readonly id: string;
  /** What the card is called, for the modal's own title. */
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wide on purpose: a screen recording of a vendor console is
          unreadable at dialog-default width. */}
      <DialogContent className="max-h-[calc(100dvh-4rem)] sm:max-w-5xl" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle icon={<HugeiconsIcon icon={CursorInfo01Icon} size={18} strokeWidth={1.75} />}>
            {t("settings.tutorial.title", { name })}
          </DialogTitle>
          <DialogDescription>
            {t("settings.tutorial.subtitle", { name })}
          </DialogDescription>
        </DialogHeader>

        {/* On a short viewport a 16:9 box at this width is taller than the
            screen, which pushed the footer out of reach. Capping the *width*
            by the height available keeps the ratio instead of letterboxing. */}
        <div className="mx-auto w-full max-w-[calc((100dvh-17rem)*16/9)]">
          <TutorialPlayer id={id} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              {t("settings.tutorial.close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The icon that opens the tutorial, for a credential card's header.
 *
 * Quiet until hovered: the card's subject is the fields, and seventeen loud
 * help buttons would compete with them.
 */
export function TutorialTrigger({
  id,
  name,
  className,
}: {
  readonly id: string;
  readonly name: string;
  readonly className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = t("settings.tutorial.watch");

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-[11px] text-muted-foreground",
              "transition-colors duration-150 hover:bg-muted hover:text-foreground",
              "focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
              className,
            )}
          >
            <HugeiconsIcon icon={CursorInfo01Icon} size={16} strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <TutorialVideoDialog
        id={id}
        name={name}
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      />
    </>
  );
}
