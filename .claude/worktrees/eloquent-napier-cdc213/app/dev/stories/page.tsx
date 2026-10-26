"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { StoryCanvas } from "@/app/landing/_components/story/kit";
import { STORIES, type StoryId } from "@/app/landing/_components/story/stories";

/**
 * The landing's story loops on a scrubber — the Remotion Studio of this repo.
 *
 * Every story is a pure function of its clock, so any moment can be drawn on
 * its own: drag the bar, or open `?scene=inbox&t=6200&w=343` to land on one
 * frame (the headless QA script does exactly that). Without `t` the story
 * plays as it does on the page.
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

const WIDTHS = [1176, 960, 704, 343] as const;

function param(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

/** Client-only, so the URL is known on the first render. */
export default dynamic(() => Promise.resolve(StoriesPage), { ssr: false });

function StoriesPage() {
  // Read once from the address; the page is client-only (dev), so the lazy
  // initialisers run in the browser.
  const [scene, setScene] = useState<StoryId>(() => {
    const s = param("scene");
    return s && s in STORIES ? (s as StoryId) : "chat";
  });
  const [time, setTime] = useState<number | undefined>(() => (param("t") === null ? undefined : Number(param("t"))));
  const [width, setWidth] = useState<number>(() => Number(param("w") ?? 1176));

  const story = STORIES[scene];

  return (
    <div className="lp min-h-dvh bg-background p-8 text-foreground">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-2 pb-6 text-sm">
        {(Object.keys(STORIES) as StoryId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setScene(id)}
            className={`rounded-lg border border-border px-3 py-1.5 ${id === scene ? "bg-foreground text-background" : "bg-card"}`}
          >
            {id}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWidth(w)}
            className={`rounded-lg border border-border px-3 py-1.5 tabular-nums ${w === width ? "bg-foreground text-background" : "bg-card"}`}
          >
            {w}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={() => setTime(time === undefined ? 0 : undefined)}
          className="rounded-lg border border-border bg-card px-3 py-1.5"
        >
          {time === undefined ? "Scrub" : "Play"}
        </button>
        {time !== undefined ? (
          <>
            <input
              type="range"
              min={0}
              max={story.script.duration}
              step={10}
              value={time}
              onChange={(event) => setTime(Number(event.target.value))}
              className="w-80"
            />
            <span className="w-16 tabular-nums">{time}</span>
          </>
        ) : null}
      </div>
      <div className="mx-auto overflow-hidden rounded-xl border border-border" style={{ width }} data-story-root>
        <StoryCanvas key={scene} script={story.script} time={time}>
          {(props) => <story.Story {...props} />}
        </StoryCanvas>
      </div>
    </div>
  );
}
