"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { TelephoneIcon } from "@hugeicons/core-free-icons";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { MessageResponse } from "@/components/ai-elements/message-response";
import { Button } from "@/components/ui/button";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchJson } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Agent, ProspectAssessment } from "@/lib/types";
import { ProspectBadge } from "../../../../../_components/prospect-badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../../_components/dashboard-card";
import { Spinner } from "@/components/ui/spinner";

type SavedCallTurn = { readonly role: "agent" | "user"; readonly message: string; readonly timeInCallSecs: number };
type SavedCallStatus = "initiated" | "in-progress" | "processing" | "done" | "failed";
export type SavedCall = {
  readonly id: string;
  readonly conversationId: string;
  readonly source: "test" | "real";
  /** Absent on rows saved before the status was tracked. */
  readonly status?: SavedCallStatus;
  readonly terminationReason?: string;
  readonly transcript: readonly SavedCallTurn[];
  readonly durationSecs?: number;
  readonly prospect?: ProspectAssessment;
  readonly startedAt: string;
};

/** A call that has not reached an end state yet. The list polls faster while
 *  one of these is on screen — this is the only part of the page that changes
 *  second to second. */
function isLive(call: SavedCall): boolean {
  return call.status === "initiated" || call.status === "in-progress" || call.status === "processing";
}

function liveLabelFor(call: SavedCall, t: ReturnType<typeof useT>): string | null {
  return call.status === "initiated"
    ? t("voice.callRinging")
    : call.status === "in-progress"
      ? t("voice.callLive")
      : call.status === "processing"
        ? t("voice.callProcessing")
        : null;
}

/** Every call the agent's ElevenLabs mirror handled — test button, in-browser
 *  Orb call, or a real inbound call — recorded server-side by the post-call
 *  webhook (see app/api/webhooks/elevenlabs). Polls lightly since the
 *  transcript can land a few seconds after a call ends.
 *
 * Same shape as the text chat page next door: a reading pane on the left for
 * whichever call is open, a list of every call on the right. A phone log is
 * something you scan and then read one of, not something you skim four lines
 * at a time inside an accordion. */
export function SavedCalls({ agent }: { readonly agent: Agent }) {
  const t = useT();
  const [calls, setCalls] = useState<SavedCall[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which call the model is currently reading. The schedule labels calls on
  // its own every few minutes; this is the "don't wait for it" button.
  const [assessingId, setAssessingId] = useState<string | null>(null);
  // Below the split this page shows one pane or the other. Stacked, the list
  // was `shrink-0` above a `flex-1` reading pane, so a handful of calls
  // squeezed the transcript to nothing and then got clipped itself.
  const [pane, setPane] = useState<"call" | "list">("list");

  const load = useCallback(async () => {
    const result = await fetchJson<{ calls: SavedCall[] }>(`/api/agents/${agent.id}/voice/calls`, t);
    if (!result.ok) return;
    setCalls(result.data.calls);
    // Land on the most recent call rather than an empty pane. A call already
    // open stays open across a poll — reselecting the newest one every few
    // seconds would yank the reader off whatever they're reading.
    setSelectedId((current) =>
      current && result.data.calls.some((call) => call.id === current)
        ? current
        : (result.data.calls[0]?.id ?? null),
    );
  }, [agent.id, t]);

  const live = calls.some(isLive);
  useEffect(() => {
    void load();
    // Fast enough to watch a call happen, slow enough to be free otherwise.
    const interval = setInterval(() => void load(), live ? 3000 : 6000);
    return () => clearInterval(interval);
  }, [load, live]);

  const assess = async (callId: string) => {
    setAssessingId(callId);
    await fetchJson("/api/prospect/assess", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "call", id: callId }),
    });
    setAssessingId(null);
    await load();
  };

  const selected = calls.find((call) => call.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-3 py-2 @min-[780px]:hidden">
        <SlidingTabs
          value={pane}
          onValueChange={(id) => setPane(id as "call" | "list")}
          tabs={[
            { id: "list", label: t("voice.savedCallsTitle") },
            { id: "call", label: t("voice.transcript") },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden @min-[780px]:flex-row">
        {/* Reading pane */}
        <div
          className={cn(
            "min-h-0 flex-1 flex-col overflow-hidden",
            pane === "call" ? "flex" : "hidden @min-[780px]:flex",
          )}
        >
          {selected ? (
            <CallDetail call={selected} assessing={assessingId === selected.id} onAssess={() => void assess(selected.id)} />
          ) : (
            <Conversation className="min-h-0 flex-1">
              <ConversationContent className="mx-auto w-full max-w-3xl gap-6 p-5">
                <ConversationEmptyState className="gap-4">
                  <div className="text-muted-foreground">
                    <HugeiconsIcon icon={TelephoneIcon} size={24} strokeWidth={1.75} />
                  </div>
                  <p className="text-sm text-muted-foreground">{t("voice.savedCallsEmpty")}</p>
                </ConversationEmptyState>
              </ConversationContent>
            </Conversation>
          )}
        </div>

        {/* Call list — scrolls independently, like the chat page's saved list */}
        <div
          className={cn(
            "min-h-0 w-full flex-1 flex-col bg-muted/20 @min-[780px]:w-[360px] @min-[780px]:flex-none @min-[780px]:shrink-0 @min-[780px]:border-l @min-[780px]:border-border",
            pane === "list" ? "flex" : "hidden @min-[780px]:flex",
          )}
        >
          <div className="y-fade flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <Card className="shrink-0">
              <CardHeader className="flex-col gap-1">
                <CardTitle>{t("voice.savedCallsTitle")}</CardTitle>
                <CardDescription>{t("voice.savedCallsDesc")}</CardDescription>
              </CardHeader>

              <div className="flex flex-col gap-2 p-5 pt-0">
                {calls.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{t("voice.savedCallsEmpty")}</p>
                ) : (
                  calls.map((call) => {
                    const isSelected = selectedId === call.id;
                    const pending = call.transcript.length === 0;
                    const failed = call.status === "failed";
                    const liveLabel = liveLabelFor(call, t);
                    return (
                      <button
                        key={call.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(call.id);
                          setPane("call");
                        }}
                        className={cn(
                          "flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                          isSelected ? "border-input bg-accent/40" : "border-border hover:bg-accent/20",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <HugeiconsIcon
                            icon={TelephoneIcon}
                            size={14}
                            strokeWidth={1.75}
                            className="shrink-0 text-muted-foreground"
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {new Date(call.startedAt).toLocaleString()}
                          </span>
                          {call.transcript.length > 0 ? <ProspectBadge prospect={call.prospect} /> : null}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <StatusBadge
                            status={call.source === "test" ? "paused" : "success"}
                            label={call.source === "test" ? t("voice.callSourceTest") : t("voice.callSourceReal")}
                          />
                          {liveLabel ? <StatusBadge status="in-progress" label={liveLabel} /> : null}
                          {failed ? <StatusBadge status="failed" label={t("voice.callFailed")} /> : null}
                          {!liveLabel && !failed ? (
                            <span>{pending ? t("voice.callPending") : `${Math.round(call.durationSecs ?? 0)}s`}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The open call, read-only — same shell as the text chat's live conversation
 *  pane: a header carrying the status and the prospect read, the transcript
 *  as chat bubbles below it. */
function CallDetail({
  call,
  assessing,
  onAssess,
}: {
  readonly call: SavedCall;
  readonly assessing: boolean;
  readonly onAssess: () => void;
}) {
  const t = useT();
  const pending = call.transcript.length === 0;
  const failed = call.status === "failed";
  const liveLabel = liveLabelFor(call, t);
  const settled = !pending && !failed;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card/40 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon icon={TelephoneIcon} size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            {new Date(call.startedAt).toLocaleString()}
          </p>
          <StatusBadge
            status={call.source === "test" ? "paused" : "success"}
            label={call.source === "test" ? t("voice.callSourceTest") : t("voice.callSourceReal")}
          />
          {liveLabel ? <StatusBadge status="in-progress" label={liveLabel} /> : null}
          {failed ? <StatusBadge status="failed" label={t("voice.callFailed")} /> : null}
          {settled ? (
            <span className="text-xs text-muted-foreground">{Math.round(call.durationSecs ?? 0)}s</span>
          ) : null}
          {settled ? <ProspectBadge prospect={call.prospect} /> : null}
          {settled ? (
            <Button size="xs" variant="ghost" disabled={assessing} onClick={onAssess}>
              {assessing ? (
                <Spinner size={12} />
              ) : null}
              {assessing ? t("prospect.assessing") : call.prospect ? t("prospect.reassess") : t("prospect.assess")}
            </Button>
          ) : null}
        </div>
        {settled ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {call.prospect
              ? `${call.prospect.reason}${call.prospect.nextStep ? ` · ${t("prospect.nextStep")}: ${call.prospect.nextStep}` : ""}`
              : t("prospect.empty")}
          </p>
        ) : null}
      </div>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 p-5">
          {pending && failed ? (
            <ConversationEmptyState className="gap-3">
              <p className="text-sm text-muted-foreground">
                {call.terminationReason === "twilio_call_ended_without_audio" ? t("voice.callEndedWithoutAudio") : call.terminationReason || t("voice.callFailedReason")}
              </p>
            </ConversationEmptyState>
          ) : pending ? (
            <ConversationEmptyState className="gap-3">
              <p className="text-sm text-muted-foreground">{liveLabel ?? t("voice.callPending")}</p>
            </ConversationEmptyState>
          ) : (
            call.transcript.map((turn, index) => (
              <Message key={index} from={turn.role === "user" ? "user" : "assistant"}>
                <MessageContent>
                  {turn.role === "user" ? turn.message : <MessageResponse>{turn.message}</MessageResponse>}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}
