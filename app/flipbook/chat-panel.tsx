"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AiSketchIcon, ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { cn } from "../../lib/utils";
import { type Flipbook, type PlaybackSettings } from "../../shared/flipbook";
import { CHAT_HISTORY_LIMIT, FLIPBOOK_CHAT_STARTERS, costLine, describePlaybackPatch, type ChatTurn, type FlipbookProposal, type PlaybackPatch } from "../../shared/flipbook-chat";
import { CHAT_MESSAGE_MAX_LENGTH } from "../../shared/schemas";
import { FlipbookApiError, flipbookApi } from "./flipbook-client";

type Entry =
  | { readonly id: number; readonly role: "user"; readonly text: string }
  | { readonly id: number; readonly role: "assistant"; readonly text: string; readonly proposal: FlipbookProposal | null; readonly state: "open" | "applied" | "dismissed" };

/** What a proposal asks of the person, in one place: the drawings it costs and what that does to the budget. */
function CostLine({ proposal }: { readonly proposal: FlipbookProposal }) {
  const { cost } = proposal;
  if (!cost.drawings) return <p className="text-[11px] leading-4 text-muted-foreground">{proposal.playback ? "Free: no drawings are redrawn." : "Nothing to redraw."}</p>;
  return (
    <p className="text-[11px] leading-4 text-muted-foreground" data-testid="chat-cost">
      <span className="text-foreground">{costLine(cost)}</span>{" "}
      {cost.overBy > 0 ? `That is ${cost.overBy} past this animation’s budget (${cost.used} of ${cost.limit} used); applying draws them anyway.` : `Drawings ${cost.used}/${cost.limit} used now.`}
    </p>
  );
}

/**
 * Talk to the animation. Each message is one Muse Spark call that answers
 * with a proposal: poses to redraw and/or playback settings. Nothing is
 * redrawn until "Apply"; playback changes are free and apply instantly.
 */
export function ChatPanel({
  flipbook,
  settings,
  busy,
  onPlayback,
  onApplyPoses,
}: {
  readonly flipbook: Flipbook;
  readonly settings: PlaybackSettings;
  /** The animation is working, or another request is in flight. */
  readonly busy: boolean;
  readonly onPlayback: (patch: PlaybackPatch) => void;
  /** Redraws the proposal's frames; resolves true when the request was accepted. */
  readonly onApplyPoses: (changes: readonly { frame: string; description: string }[], confirmExtra: boolean) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server's switch for paid AI work, read from the health report and from the first refusal.
  const [aiOff, setAiOff] = useState(false);
  const inputId = useId();
  const nextId = useRef(1);
  const listRef = useRef<HTMLOListElement>(null);
  const sendLock = useRef(false);

  useEffect(() => {
    let live = true;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((report: { checks?: { aiEnabled?: boolean } }) => { if (live && report.checks?.aiEnabled === false) setAiOff(true); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  // Settle the list before it paints; scrolling after paint flashes the old position.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries, pending]);

  const ready = Boolean(flipbook.plan);
  const disabled = aiOff || !ready;
  const asking = pending !== null;
  const canSend = text.trim().length >= 2 && !asking && !disabled;
  // Only the newest proposal can still be applied: older ones were made for an earlier plan.
  const open = [...entries].reverse().find((entry) => entry.role === "assistant" && entry.proposal && entry.state === "open");

  const history = (): ChatTurn[] => entries.slice(-CHAT_HISTORY_LIMIT).map((entry) => ({ role: entry.role, text: entry.text.slice(0, 600) }));

  const send = async (message: string) => {
    const value = message.trim();
    if (value.length < 2 || sendLock.current || disabled) return;
    sendLock.current = true;
    const userEntry: Entry = { id: nextId.current++, role: "user", text: value };
    setError(null);
    setText("");
    setPending(userEntry.id);
    // One bubble from send through reply: replacing a provisional copy makes it flicker.
    setEntries((current) => [...current, userEntry]);
    try {
      const proposal = await flipbookApi.chat(flipbook.id, {
        message: value,
        history: history(),
        playback: { drawingFps: settings.drawingFps, durationSeconds: settings.durationSeconds, motion: settings.motion, speed: settings.speed },
      });
      const actionable = proposal.changes.length > 0 || proposal.playback !== null;
      const reply: Entry = { id: nextId.current++, role: "assistant", text: proposal.reply, proposal: actionable || proposal.skipped.length ? proposal : null, state: actionable ? "open" : "dismissed" };
      setEntries((current) => [
        ...current.map((entry) => (entry.role === "assistant" && entry.state === "open" ? { ...entry, state: "dismissed" as const } : entry)),
        reply,
      ]);
    } catch (failure) {
      if (failure instanceof FlipbookApiError && failure.code === "ai_disabled") setAiOff(true);
      setEntries((current) => current.filter((entry) => entry.id !== userEntry.id));
      setText(value);
      setError(failure instanceof Error ? failure.message : "Try again.");
    } finally {
      sendLock.current = false;
      setPending(null);
    }
  };

  const setState = (id: number, state: "applied" | "dismissed") =>
    setEntries((current) => current.map((entry) => (entry.id === id && entry.role === "assistant" ? { ...entry, state } : entry)));

  const apply = async (entry: Extract<Entry, { role: "assistant" }>) => {
    const proposal = entry.proposal;
    if (!proposal || applying || busy) return;
    setApplying(true);
    try {
      // Redraw first: if the server refuses, nothing else has changed.
      if (proposal.changes.length) {
        const accepted = await onApplyPoses(proposal.changes.map((change) => ({ frame: change.frame, description: change.description })), proposal.cost.overBy > 0);
        if (!accepted) return;
      }
      if (proposal.playback) onPlayback(proposal.playback);
      setState(entry.id, "applied");
    } finally {
      setApplying(false);
    }
  };

  const proposalButton = (proposal: FlipbookProposal) => {
    const n = proposal.changes.length;
    if (!n) return "Apply";
    return `Apply and redraw ${n} ${n === 1 ? "frame" : "frames"}`;
  };

  return (
    // Flat, like the composer: no card, no border box.
    <section aria-label="Animation chat" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary">
          <HugeiconsIcon icon={AiSketchIcon} size={14} strokeWidth={1.75} />
        </span>
        <h3 className="text-sm font-medium">Change the movement</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">Muse Spark · nothing redraws until you apply</span>
      </header>

      {aiOff ? (
        <p className="text-xs leading-5 text-muted-foreground" role="status" data-testid="chat-disabled">
          AI editing is paused right now, so the chat is off. You can still redraw any frame or change the playback by hand.
        </p>
      ) : null}

      {entries.length || asking ? (
        <ol ref={listRef} aria-live="polite" aria-busy={asking} className="scrollbar-hide flex max-h-72 flex-col gap-2.5 overflow-y-auto overscroll-contain [overflow-anchor:none] [&>li]:shrink-0">
          {entries.map((entry) =>
            entry.role === "user" ? (
              <li key={entry.id} className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-muted px-3 py-2 text-xs leading-5 text-foreground">
                {entry.text}
              </li>
            ) : (
              <li key={entry.id} className="flex max-w-[96%] flex-col gap-2 self-start">
                <p className="text-xs leading-5 text-foreground">{entry.text}</p>
                {entry.proposal ? (
                  <div className={cn("flex flex-col gap-2", entry.state === "dismissed" && "opacity-60")}>
                    {entry.proposal.changes.length ? (
                      <ul className="flex flex-col gap-1" aria-label="Frames to redraw">
                        {entry.proposal.changes.map((change) => (
                          <li key={change.frame} className="text-[11px] leading-4 text-muted-foreground">
                            <span className="text-foreground">Frame {change.position} · {change.label}</span> — {change.summary}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {entry.proposal.playback ? (
                      <ul className="flex flex-wrap gap-1" aria-label="Playback changes">
                        {describePlaybackPatch(entry.proposal.playback).map((part) => (
                          <li key={part} className="rounded-md bg-[#ffffff08] px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">{part}</li>
                        ))}
                      </ul>
                    ) : null}
                    {entry.proposal.skipped.map((skipped) => (
                      <p key={skipped.frame} className="text-[11px] leading-4 text-muted-foreground">Frame {skipped.position} · {skipped.label} left as it is. {skipped.reason}</p>
                    ))}
                    {entry.state === "open" ? (
                      <>
                        <CostLine proposal={entry.proposal} />
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button size="xs" variant="ai" disabled={busy || applying || entry.id !== open?.id} onClick={() => void apply(entry)} aria-busy={applying || undefined}>
                            {applying ? <Spinner className="size-3" /> : null}
                            {proposalButton(entry.proposal)}
                          </Button>
                          <Button size="xs" variant="ghost" disabled={applying} onClick={() => setState(entry.id, "dismissed")}>Not now</Button>
                        </div>
                      </>
                    ) : (
                      <span className="text-[11px] text-primary">{entry.state === "applied" ? (entry.proposal.changes.length ? "Applied · redrawing" : "Applied") : "Dismissed"}</span>
                    )}
                  </div>
                ) : null}
              </li>
            ),
          )}
          {asking ? (
            <li key="pending" className="flex items-center gap-2 self-start text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Planning the change…
            </li>
          ) : null}
        </ol>
      ) : (
        <>
          <p className="text-xs leading-5 text-muted-foreground">Say what to change — “wave with the other hand”, “slower, smaller movement”, “change frame 4 so the arm is higher”. You’ll see what it costs before anything is redrawn.</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Ideas">
            {FLIPBOOK_CHAT_STARTERS.map((starter) => (
              <SuggestionChip key={starter} size="xs" disabled={disabled || busy} onClick={() => void send(starter)} className="rounded-full">
                {starter}
              </SuggestionChip>
            ))}
          </div>
        </>
      )}

      {error ? <p className="text-xs leading-5 text-destructive" role="alert">{error}</p> : null}

      <form
        className={cn(
          // Same quiet surface as the composer field: an inset hairline, no border box.
          "flex items-end gap-2 rounded-[14px] bg-[linear-gradient(180deg,#ffffff06,#ffffff02)] p-1.5 pl-3.5 shadow-[inset_0_0_0_1px_#ffffff0d,inset_0_1px_0_#ffffff08] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_55%,transparent),0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)]",
          (asking || disabled) && "opacity-70",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">Tell the animation what to change</label>
        <textarea
          id={inputId}
          value={text}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          disabled={disabled}
          placeholder={aiOff ? "Chat is paused" : entries.length ? "What else?" : "e.g. Make her wave with the other hand"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
          className="max-h-24 min-h-7 flex-1 resize-none bg-transparent py-1 text-xs leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <Button type="submit" variant="ai" size="icon-sm" disabled={!canSend} aria-label="Send to the animation assistant" aria-busy={asking || undefined}>
          {asking ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={ArrowUp02Icon} size={14} strokeWidth={2} />}
        </Button>
      </form>
    </section>
  );
}
