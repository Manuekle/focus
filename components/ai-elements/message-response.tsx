"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import {
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  MaximizeScreenIcon,
  Tick02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown, type IconMap } from "streamdown";
import { HugeiconsIcon, type IconSvgElement } from "../icons/icon";
import { mermaid } from "./mermaid-plugin";
import { cn } from "../../lib/utils";

/**
 * The Markdown half of a message, in its own module.
 *
 * It used to live in `message.tsx` beside `Message` and `MessageContent`,
 * which are two divs with classes on them. Importing those two divs therefore
 * pulled in Streamdown and its four plugins — Shiki for `code`, KaTeX for
 * `math`, Mermaid for diagrams — because a module is the unit a bundler
 * splits on. The landing page's hero mockup imports `Message` to render a
 * fake conversation of plain strings, and paid for the whole Markdown stack
 * on first load to do it.
 *
 * Mermaid is this file's own plugin rather than `@streamdown/mermaid` — see
 * `mermaid-plugin.ts` for why a DOM-free renderer is the right one here.
 *
 * So the split is not stylistic: `message.tsx` is now cheap to import, and
 * the cost lands only on the three screens that actually render Markdown.
 */
export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

// Streamdown's built-in controls also follow the app's icon family.
function markdownIcon(icon: IconSvgElement): IconMap["CheckIcon"] {
  return function MarkdownIcon({ strokeWidth = 1.75, ...props }) {
    return <HugeiconsIcon icon={icon} size={16} strokeWidth={Number(strokeWidth)} {...props} />;
  };
}

const streamdownIcons: IconMap = {
  CheckIcon: markdownIcon(Tick02Icon),
  CopyIcon: markdownIcon(Copy01Icon),
  DownloadIcon: markdownIcon(Download01Icon),
  ExternalLinkIcon: markdownIcon(LinkSquare02Icon),
  Loader2Icon: markdownIcon(Loading03Icon),
  Maximize2Icon: markdownIcon(MaximizeScreenIcon),
  RotateCcwIcon: markdownIcon(Loading03Icon),
  XIcon: markdownIcon(Cancel01Icon),
  ZoomInIcon: markdownIcon(ZoomInAreaIcon),
  ZoomOutIcon: markdownIcon(ZoomOutAreaIcon),
};

/**
 * Copy, download, fullscreen and pan-zoom, off for diagrams only.
 *
 * A diagram in a reply is a picture: nobody wants the source of a five-node
 * flow on their clipboard, and the buttons cost a permanent 32px strip plus a
 * caption row above every one of them. Code and table blocks keep theirs —
 * copying a snippet is the whole point of a snippet.
 *
 * The rest of the wrapper Streamdown draws around a diagram is not
 * configurable; `app/globals.css` takes it off.
 */
const streamdownControls = { mermaid: false } as const;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      controls={streamdownControls}
      plugins={streamdownPlugins}
      icons={streamdownIcons}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating && prevProps.components === nextProps.components,
);

MessageResponse.displayName = "MessageResponse";
