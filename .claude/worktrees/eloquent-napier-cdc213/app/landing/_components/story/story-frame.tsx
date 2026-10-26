"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { type LazyExoticComponent, lazy, type ReactNode, useState } from "react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useT } from "@/lib/i18n/provider";
import { DeferredDemo } from "../deferred-demo";
import { BOARDS } from "./boards";
import { StoryStage } from "./kit";

/**
 * A story loop on the page: no browser window around it, no caption under
 * it — the cards stand on a dot plate that dissolves into the page.
 *
 * Each story is imported near the viewport, behind a stage of exactly its
 * size. On phones the hero's story sits below the offer: its code waits until
 * a useful part is visible, leaving the headline's fonts first in line.
 *
 * The picture is one labelled image and everything in it is `inert`. The
 * loops run on their own, so WCAG 2.2.2 asks for a way to stop them: a pause
 * button that stays out of sight until it is reached from the keyboard, and
 * is announced to screen readers like any other control.
 */

export type StoryScene = "chat" | "inbox" | "ads" | "agents" | "automation";

type LoopProps = { readonly paused: boolean };

const LOOPS: Record<StoryScene, LazyExoticComponent<(props: LoopProps) => ReactNode>> = {
  chat: lazy(() => import("./story-chat").then((module) => ({ default: module.ChatLoop }))),
  inbox: lazy(() => import("./story-inbox").then((module) => ({ default: module.InboxLoop }))),
  ads: lazy(() => import("./story-ads").then((module) => ({ default: module.AdsLoop }))),
  agents: lazy(() => import("./story-agents").then((module) => ({ default: module.AgentsLoop }))),
  automation: lazy(() => import("./story-automation").then((module) => ({ default: module.AutomationLoop }))),
};

export function StoryFrame({ scene, label }: { readonly scene: StoryScene; readonly label: string }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);

  const Loop = LOOPS[scene];
  const loop = (
    <DeferredDemo
      className="w-full"
      rootMargin={scene === "chat" ? "0px" : "200px 0px"}
      threshold={scene === "chat" ? 0.1 : 0}
      fallback={<StoryStage board={BOARDS[scene]} />}
    >
      <Loop paused={paused} />
    </DeferredDemo>
  );

  return (
    <div className="relative">
      <div aria-label={label} role="img">
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: `inert` is the point — the story is a picture. */}
        <div inert>{loop}</div>
      </div>
      {reduced ? null : (
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          className="sr-only absolute bottom-2 left-1/2 z-10 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-[var(--shadow-soft)] focus-visible:not-sr-only focus-visible:inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={12} strokeWidth={2} />
          {t(paused ? "landing.story.play" : "landing.story.pause")}
        </button>
      )}
    </div>
  );
}
