"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AiPaintbrushIcon, AiSketchIcon, ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import type { ImageLook } from "../../shared/flipbook";
import type { CharacterSource } from "../../shared/characters";
import { GUIDE_MAX_MESSAGES, GUIDE_MESSAGE_MAX, guidedDrawings, type GuideMessage, type GuidedSetup } from "../../shared/flipbook-onboarding";
import { FlipbookApiError, flipbookApi } from "./flipbook-client";

/**
 * Guided setup: the animator says in their own words what the character
 * should do, Muse Spark asks only what it can't decide (in the animator's
 * language) and then picks every setting. Creating is still the animator's
 * click, with the drawing count stated first. The Advanced form keeps the
 * manual controls.
 */
export function GuidedSetup({
  picture,
  look,
  creating,
  blockedReason,
  onCreate,
}: {
  /** The upload, or the saved character's version (read only for its owner). */
  readonly picture: { readonly imageId: string } | { readonly characterSource: CharacterSource };
  readonly look: ImageLook | null;
  readonly creating: boolean;
  readonly blockedReason: string | null;
  readonly onCreate: (setup: GuidedSetup) => void;
}) {
  const inputId = useId();
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const [setup, setSetup] = useState<GuidedSetup | null>(null);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length, asking]);

  const subject = look?.analysis.subject;
  const send = async (value: string) => {
    const words = value.trim();
    if (!words || asking) return;
    const next = [...messages, { role: "user" as const, text: words.slice(0, GUIDE_MESSAGE_MAX) }].slice(-GUIDE_MAX_MESSAGES);
    setMessages(next);
    setText("");
    setError(null);
    setAsking(true);
    try {
      const reply = await flipbookApi.guide(picture, next);
      setMessages((current) => [...current, { role: "assistant" as const, text: reply.reply }]);
      // A later answer can change a decided setup; a question alone keeps the last one on screen.
      if (reply.setup) setSetup(reply.setup);
    } catch (failure) {
      setMessages(messages);
      setText(words);
      setError(failure instanceof FlipbookApiError || failure instanceof Error ? failure.message : "Muse Spark didn’t answer. Try again.");
    } finally {
      setAsking(false);
    }
  };
  const drawings = setup ? guidedDrawings(setup) : 0;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Guided setup">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary">
          <HugeiconsIcon icon={AiSketchIcon} size={14} strokeWidth={1.75} />
        </span>
        <h2 className="text-sm font-medium">What should {subject ? `the ${subject}` : "your character"} do?</h2>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Describe it in your own words: what it does, how it feels, how fast or how long. Muse Spark asks only what it can’t decide and picks every setting. Nothing is drawn until you create it.</p>

      {messages.length || asking ? (
        <ol ref={listRef} aria-live="polite" aria-busy={asking} className="scrollbar-hide flex max-h-80 flex-col gap-2.5 overflow-y-auto overscroll-contain [&>li]:shrink-0">
          {messages.map((message, index) => message.role === "user" ? (
            <li key={index} className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-muted px-3 py-2 text-xs leading-5 text-foreground">{message.text}</li>
          ) : (
            <li key={index} className="max-w-[96%] self-start text-xs leading-5 text-foreground">{message.text}</li>
          ))}
          {asking ? <li className="flex items-center gap-2 self-start text-xs text-muted-foreground"><Spinner className="size-3" />Muse Spark is thinking…</li> : null}
        </ol>
      ) : null}

      {error ? <p className="text-xs leading-5 text-destructive" role="alert">{error}</p> : null}

      <form
        className={cn(
          "flex items-end gap-2 rounded-[14px] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--foreground)_2.4%,transparent),color-mix(in_srgb,var(--foreground)_0.8%,transparent))] p-1.5 pl-3.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5.1%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_3.1%,transparent)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_55%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)]",
          asking && "opacity-70",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">Tell Muse Spark what the animation should be</label>
        <textarea
          id={inputId}
          value={text}
          rows={2}
          maxLength={GUIDE_MESSAGE_MAX}
          placeholder={messages.length ? "Your answer…" : "e.g. She walks slowly toward the camera, swinging her arms, and blinks gently"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-1 text-xs leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <Button type="submit" variant="ai" size="icon-sm" disabled={!text.trim() || asking} aria-label="Send to Muse Spark" aria-busy={asking || undefined}>
          {asking ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={ArrowUp02Icon} size={14} strokeWidth={2} />}
        </Button>
      </form>

      {setup ? (
        <div className="flex flex-col gap-2 pt-1" data-testid="guided-summary">
          <p className="text-xs leading-5 text-foreground">{setup.summary}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {setup.mode === "sequence" ? `${setup.durationSeconds} s · ${setup.drawingFps} drawings/s` : "Looping cycle · 8 key poses"} · {drawings} {drawings === 1 ? "drawing" : "drawings"} · {setup.action}{setup.view !== "original" ? ` · ${setup.view.replace("_", "-")} view` : ""}
          </p>
          <Button variant="ai" size="lg" disabled={creating || Boolean(blockedReason)} aria-busy={creating || undefined} onClick={() => onCreate(setup)}>
            {creating ? <Spinner /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={16} strokeWidth={1.75} />}
            Create animation
          </Button>
          {blockedReason ? <p className="text-[11px] leading-4 text-muted-foreground">{blockedReason}</p> : <p className="text-[11px] leading-4 text-muted-foreground">Want something different? Keep writing and Muse Spark adjusts it.</p>}
        </div>
      ) : null}
    </section>
  );
}
