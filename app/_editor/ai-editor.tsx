"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AiReplaceIcon, ArrowUp02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { cn } from "../../lib/utils";
import type { RenderParams } from "../../shared/render";
import { CHAT_MESSAGE_MAX_LENGTH, type ChatMessage } from "../../shared/schemas";

const STARTERS = ["Make it cinematic", "Add a soft gold glow", "Film grain and a vignette", "More dramatic"] as const;

const sameParams = (a: RenderParams | undefined, b: RenderParams) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/**
 * A conversation about the finished edit. Each message is one Muse Spark
 * call that returns bounded settings; the change re-renders from the saved
 * masks, so nothing is tracked again and earlier versions come back for free.
 */
export function AiEditor({
  messages,
  current,
  pending,
  disabled,
  onSend,
  onRestore,
  onStartEdit,
}: {
  readonly messages: readonly ChatMessage[];
  /** The parameters of the render on screen. */
  readonly current: RenderParams;
  /** The message being answered right now, shown before the server confirms it. */
  readonly pending: string | null;
  readonly disabled: boolean;
  readonly onSend: (message: string) => void;
  readonly onRestore: (messageId: string) => void;
  readonly onStartEdit: (instruction: string) => void;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const busy = pending !== null;
  const canSend = text.trim().length >= 2 && !busy && !disabled;

  // Newest turn in view; the list scrolls, the page does not.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, pending]);

  const send = (message: string) => {
    const value = message.trim();
    if (value.length < 2 || busy || disabled) return;
    onSend(value);
    setText("");
  };

  // The newest assistant turn whose version is on screen gets the "on screen" mark.
  const live = [...messages].reverse().find((message) => sameParams(message.params, current))?.id;

  return (
    // Sits straight on the panel like the composer: no card, no border.
    <section aria-label="AI editor" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary">
          <HugeiconsIcon icon={AiReplaceIcon} size={14} strokeWidth={1.75} />
        </span>
        <h3 className="text-sm font-medium">AI editor</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">Muse Spark · same masks</span>
      </header>

      {messages.length || pending ? (
        <ol ref={listRef} aria-live="polite" className="flex max-h-80 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1">
          {messages.map((message) =>
            message.role === "user" ? (
              <li key={message.id} className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-muted px-3 py-2 text-xs leading-5 text-foreground">
                {message.text}
              </li>
            ) : (
              <li key={message.id} className="flex max-w-[92%] flex-col gap-1.5 self-start">
                <p className="text-xs leading-5 text-foreground">{message.text}</p>
                {message.changes?.length ? (
                  <ul className="flex flex-wrap gap-1" aria-label="Changes">
                    {message.changes.map((change) => (
                      <li key={change} className="rounded-md bg-[color-mix(in_srgb,var(--foreground)_3.1%,transparent)] px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                        {change}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.params ? (
                  message.id === live ? (
                    <span className="text-[11px] text-primary">On screen</span>
                  ) : sameParams(message.params, current) ? null : (
                    <button
                      type="button"
                      disabled={busy || disabled}
                      onClick={() => onRestore(message.id)}
                      className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <HugeiconsIcon icon={Undo02Icon} size={12} strokeWidth={1.75} />
                      Use this version
                    </button>
                  )
                ) : null}
                {message.suggestion ? (
                  <Button variant="outline" size="xs" className="w-fit max-w-full" disabled={busy || disabled} onClick={() => onStartEdit(message.suggestion!)}>
                    <span className="truncate">New edit: “{message.suggestion}”</span>
                  </Button>
                ) : null}
              </li>
            ),
          )}
          {pending ? (
            <>
              <li className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-muted px-3 py-2 text-xs leading-5 text-foreground">{pending}</li>
              <li className="flex items-center gap-2 self-start text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Thinking about your edit…
              </li>
            </>
          ) : null}
        </ol>
      ) : (
        <>
          <p className="text-xs leading-5 text-muted-foreground">Tell it what else you want — a look, a glow around the subject, more drama, another effect. It re-renders from your saved masks.</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Ideas">
            {STARTERS.map((starter) => (
              <SuggestionChip key={starter} size="xs" disabled={disabled} onClick={() => send(starter)} className="rounded-full">

                {starter}
              </SuggestionChip>
            ))}
          </div>
        </>
      )}

      <form
        className={cn(
          // Same quiet surface as the composer field: an inset hairline, no border box.
          "flex items-end gap-2 rounded-[14px] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--foreground)_2.4%,transparent),color-mix(in_srgb,var(--foreground)_0.8%,transparent))] p-1.5 pl-3.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5.1%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_3.1%,transparent)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_55%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)]",
          (busy || disabled) && "opacity-70",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Tell the AI editor what to change
        </label>
        <textarea
          id={inputId}
          value={text}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          disabled={disabled}
          placeholder={messages.length ? "What else?" : "e.g. Warmer, with a cyan outline"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(text);
            }
          }}
          className="max-h-24 min-h-7 flex-1 resize-none bg-transparent py-1 text-xs leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <Button type="submit" variant="ai" size="icon-sm" disabled={!canSend} aria-label="Send to the AI editor" aria-busy={busy}>
          {busy ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={ArrowUp02Icon} size={14} strokeWidth={2} />}
        </Button>
      </form>
    </section>
  );
}
